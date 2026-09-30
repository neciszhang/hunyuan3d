# AI3D SDK request examples

These are request JSON examples for `hunyuan3d validate <operation> file.json`. Field names and enum casing follow Tencent Cloud AI3D `v20250513`. Replace example HTTPS URLs with files the Tencent service can actually fetch. Run `hunyuan3d operations` for each action's live guide. A generated 3D output URL normally expires after 24 hours.

## `pro`: professional generation

```json
{"Model":"3.1","ImageBase64":"@front.png","MultiViewImages":[{"ViewType":"left","ViewImageBase64":"@left.png"},{"ViewType":"top","ViewImageBase64":"@top.png"}],"EnablePBR":true,"FaceCount":25000,"GenerateType":"Normal"}
```

Also accepts `Prompt`, `ImageUrl`, `PolygonType`, and `ResultFormat`; 3.1 does not support `LowPoly`. See [official parameters](https://cloud.tencent.com/document/api/1804/123447).

## `rapid`: rapid generation

```json
{"Prompt":"一把木质椅子","ResultFormat":"GLB","EnablePBR":true}
```

Also accepts `ImageBase64`, `ImageUrl`, and `EnableGeometry`. See [official parameters](https://cloud.tencent.com/document/api/1804/123463).

## `texture`: texture a model

```json
{"File3D":{"Type":"GLB","Url":"https://example.com/plain.glb"},"Model":"3.1","Image":{"Base64":"@texture.png"},"EnablePBR":true,"EnableKeepUV":true,"TextureSize":2048}
```

Also accepts `Prompt` and `MultiViewImages`. The 3D input is an HTTPS URL, not local Base64. See [official parameters](https://cloud.tencent.com/document/api/1804/126292).

## `reduce-face`: intelligent topology

```json
{"File3D":{"Type":"GLB","Url":"https://example.com/high.glb"},"PolygonType":"triangle","FaceLevel":"low"}
```

See [official parameters](https://cloud.tencent.com/document/api/1804/126293).

## `parts`: component generation

```json
{"File":{"Type":"FBX","Url":"https://example.com/asset.fbx"},"Model":"1.5","EnableStagedGeneration":true,"EnablePostProcess":false}
```

Also accepts `PartSegmentationInfo`. The `File` input supports FBX. See [official parameters](https://cloud.tencent.com/document/api/1804/126295).

## `uv`: unwrap UV

```json
{"File":{"Type":"GLB","Url":"https://example.com/model.glb"}}
```

See [official parameters](https://cloud.tencent.com/document/api/1804/126294).

## `motion`: text to motion

```json
{"Prompt":"A person walks forward","Model":"HY-Motion-1.0","Duration":5,"EnableMesh":true,"EnableRewrite":true,"EnableDurationEst":false}
```

Also accepts `RetargetFile` as an SDK `InputFile3D` object. See [official parameters](https://cloud.tencent.com/document/api/1804/131256).

## `rig`: bind skeleton and skin

```json
{"File3D":{"Type":"FBX","Url":"https://example.com/t-pose.fbx"},"MotionType":1}
```

See [official parameters](https://cloud.tencent.com/document/api/1804/131618).

## `profile`: 3D person

```json
{"Profile":{"Base64":"@portrait.jpg"},"Template":"basketball"}
```

Also accepts `Profile.Url`. See [official parameters](https://cloud.tencent.com/document/api/1804/127685).

## `convert`: cloud format conversion

```json
{"File3D":"https://example.com/model.glb","Format":"FBX"}
```

Run `hunyuan3d convert convert.json --state convert-job.json --confirm-spend`; it returns a direct result URL in the saved state. See [official parameters](https://cloud.tencent.com/document/api/1804/126300).
