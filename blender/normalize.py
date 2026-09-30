"""Run with Blender: blender -b --python normalize_glb.py -- <args>."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import sys

import bpy
from mathutils import Matrix, Vector


FRONTS = {"+X": (1, 0), "-X": (-1, 0), "+Y": (0, 1), "-Y": (0, -1)}


def parse() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--version", type=int, required=True)
    parser.add_argument("--source-front", choices=FRONTS, required=True)
    parser.add_argument("--target-size", type=float, nargs=3, metavar=("WIDTH", "DEPTH", "HEIGHT"), required=True)
    parser.add_argument("--attachment", choices=("floor", "wall", "ceiling", "free"), default="floor")
    parser.add_argument("--anchor", choices=("bottom-center", "center"), default="bottom-center")
    parser.add_argument("--source-job-id")
    parser.add_argument("--provider-model", help="source model ID, for example hy-3d-3.1")
    parser.add_argument("--source-dir", type=Path, help="copy downloaded vendor files and safe receipt into source/")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    if not points:
        raise ValueError("GLB contains no mesh bounds")
    return Vector(tuple(min(point[i] for point in points) for i in range(3))), Vector(
        tuple(max(point[i] for point in points) for i in range(3))
    )


def transform_meshes(objects: list[bpy.types.Object], matrix: Matrix) -> None:
    for obj in objects:
        obj.data = obj.data.copy()
        obj.data.transform(matrix @ obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)
        obj.data.update()
    bpy.context.view_layer.update()


def add_preview_camera(objects: list[bpy.types.Object], out: Path, direction: Vector, name: str) -> None:
    low, high = bounds(objects)
    center = (low + high) / 2
    size = max(high[i] - low[i] for i in range(3))
    cam_data = bpy.data.cameras.new(f"QA-{name}")
    cam = bpy.data.objects.new(f"QA-{name}", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + direction.normalized() * (size * 3)
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.7
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = str(out / "previews" / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def main() -> None:
    args = parse()
    if args.version < 1 or any(x <= 0 for x in args.target_size):
        raise ValueError("version and target-size values must be positive")
    if args.out.exists() and any(args.out.iterdir()):
        raise ValueError("output directory must be empty to preserve immutable versions")
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "previews").mkdir()
    if args.source_dir:
        source_dir = args.source_dir.resolve()
        if not source_dir.is_dir() or source_dir == args.out.resolve():
            raise ValueError("source-dir must be an existing separate directory")
        source_out = args.out / "source"
        source_out.mkdir()
        for item in source_dir.iterdir():
            if item.is_file() and not item.is_symlink():
                shutil.copy2(item, source_out / item.name)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(args.input.resolve()))
    if any(obj.type == "ARMATURE" for obj in bpy.context.scene.objects) or bpy.data.actions:
        raise ValueError("normalizer handles static assets only; rigged or animated GLB needs a separate workflow")
    objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not objects:
        raise ValueError("input GLB has no mesh objects")
    # Bake the vendor hierarchy into mesh coordinates before measuring or exporting.
    transform_meshes(objects, Matrix.Identity(4))
    sx, sy = FRONTS[args.source_front]
    angle = math.atan2(-1, 0) - math.atan2(sy, sx)
    transform_meshes(objects, Matrix.Rotation(angle, 4, "Z"))
    low, high = bounds(objects)
    actual = high - low
    if any(x <= 1e-7 for x in actual):
        raise ValueError("mesh has a zero-sized axis")
    uniform_scale = min(args.target_size[i] / actual[i] for i in range(3))
    transform_meshes(objects, Matrix.Scale(uniform_scale, 4))
    low, high = bounds(objects)
    center_xy = ((low.x + high.x) / 2, (low.y + high.y) / 2)
    center_z = (low.z + high.z) / 2
    z_offset = low.z if args.anchor == "bottom-center" else center_z
    transform_meshes(objects, Matrix.Translation(Vector((-center_xy[0], -center_xy[1], -z_offset))))
    low, high = bounds(objects)
    dimensions = [round(high[i] - low[i], 6) for i in range(3)]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    target = args.out / "model.glb"
    bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", use_selection=True)
    bpy.ops.object.select_all(action="DESELECT")
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.6, 0.6, 0.6)
    light_data = bpy.data.lights.new("QA-area", type="AREA")
    light = bpy.data.objects.new("QA-area", light_data)
    scene.collection.objects.link(light)
    light.location = (2, -3, 4)
    light_data.energy = 700
    light_data.shape = "DISK"
    light_data.size = 5
    for name, direction in (("front", Vector((0, -1, 0.3))), ("back", Vector((0, 1, 0.3))),
                            ("side", Vector((1, 0, 0.3))), ("top", Vector((0, 0, 1)))):
        add_preview_camera(objects, args.out, direction, name)
    manifest = {
        "schema": "hunyuan-asset.v1",
        "assetId": args.asset_id,
        "version": args.version,
        "status": "needs_review",
        "model": "model.glb",
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "dimensionsMeters": dimensions,
        "requestedMaxDimensionsMeters": args.target_size,
        "frontAxis": "-Y",
        "upAxis": "+Z",
        "anchor": args.anchor,
        "attachment": args.attachment,
        "sourceJobId": args.source_job_id,
        "providerModel": args.provider_model,
        "review": {"geometry": None, "appearance": None, "views": [f"previews/{name}.png" for name in ("front", "back", "side", "top")]},
    }
    (args.out / "asset.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"asset": str(args.out), "status": "needs_review", "dimensionsMeters": dimensions}))


if __name__ == "__main__":
    main()
