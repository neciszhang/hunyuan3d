import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { resizeTextures } from '../src/texture-resize.js';

test('texture resize selects material slots even when texture names are misleading', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunyuan-textures-'));
  const input = join(dir, 'source.glb'), output = join(dir, 'resized.glb');
  const document = new Document(), buffer = document.createBuffer();
  const image = async (color) => sharp({ create: { width: 1024, height: 1024, channels: 4,
    background: color } }).png().toBuffer();
  const base = document.createTexture('looks_like_normal').setMimeType('image/png')
    .setImage(await image('#43bcb0'));
  const normal = document.createTexture('looks_like_base_color').setMimeType('image/png')
    .setImage(await image('#8080ff'));
  const mr = document.createTexture('generic_texture').setMimeType('image/png')
    .setImage(await image('#00b400'));
  const material = document.createMaterial('PBR').setBaseColorTexture(base)
    .setNormalTexture(normal).setMetallicRoughnessTexture(mr);
  const positions = document.createAccessor('POSITION').setType('VEC3').setBuffer(buffer)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  const normals = document.createAccessor('NORMAL').setType('VEC3').setBuffer(buffer)
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  const uvs = document.createAccessor('TEXCOORD_0').setType('VEC2').setBuffer(buffer)
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1]));
  const indices = document.createAccessor('indices').setType('SCALAR').setBuffer(buffer)
    .setArray(new Uint16Array([0, 1, 2]));
  const primitive = document.createPrimitive().setAttribute('POSITION', positions)
    .setAttribute('NORMAL', normals).setAttribute('TEXCOORD_0', uvs)
    .setIndices(indices).setMaterial(material);
  document.createScene('scene').addChild(document.createNode('node').setMesh(
    document.createMesh('mesh').addPrimitive(primitive)));
  const io = new NodeIO();
  await io.write(input, document);

  const result = await resizeTextures({ input, out: output,
    sizes: { baseColor: 512, normal: 256, metallicRoughness: 128 } });
  assert.equal(result.changes.length, 3);
  const resized = await io.read(output);
  const textures = resized.getRoot().listTextures();
  const dimensions = Object.fromEntries(await Promise.all(textures.map(async (texture) =>
    [texture.getName(), (await sharp(texture.getImage()).metadata()).width])));
  assert.deepEqual(dimensions, { looks_like_normal: 512, looks_like_base_color: 256,
    generic_texture: 128 });
  assert.equal(resized.getRoot().listMeshes()[0].listPrimitives()[0].getIndices().getCount(), 3);
});
