# Scene handoff

One asset version is immutable. Suggested package:

```text
assets/<asset-id>/v1/
  asset.json
  model.glb                 # normalized and visually accepted
  previews/                # front, side, back, top
  source/                  # vendor output, input images, prompt, task receipt
```

`asset.json` records `schema`, `assetId`, `version`, `status`, relative `model`, `sha256`, `dimensionsMeters`, `frontAxis`, `upAxis`, `anchor`, `attachment`, `sourceJobId`, `providerModel`, and `review` evidence. Use `status: ready` only after GLB normalization and visual QA. Do not store signed download URLs, credentials, or encoded input images in the manifest. The scene may import a ready version by `assetId` and `version`; it owns each instance's world transform and scene-level checks.

The Blender normalizer outputs a package with `status: needs_review`, actual measured dimensions, and a hash. `--target-size` is a maximum bounding envelope; the script preserves proportions and records the actual scaled dimensions. Supply intended dimensions and source front; an automated mesh import cannot reliably infer the semantic front or whether a model's back/underside is acceptable. After viewing its previews and performing mesh/material QA, run `hunyuan3d asset review` to set `status: ready` and add review evidence. Keep the vendor original for repairs and provenance. Separate independently placed parts into separate packages.
