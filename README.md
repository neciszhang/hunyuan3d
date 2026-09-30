# hunyuan3d

Generate 3D models from text or images, manage cloud jobs, and prepare GLB assets from your terminal.

`hunyuan3d` brings Tencent Cloud AI3D generation and local model processing into one CLI for Web 3D, game, and Blender asset workflows. Cloud operations use Tencent Cloud's official AI3D Node SDK. Local tools use glTF-Transform, Sharp, and optional Blender integration. This package is an independent CLI project.

## Features

| Feature | What you can do |
| --- | --- |
| Text and image to 3D | Generate models with Pro or Rapid; provide multiple views for Pro jobs |
| Cloud model processing | Generate textures, reduce polygon counts, generate components, and unwrap UVs |
| Characters and animation | Submit character generation, automatic rigging, and text-to-motion jobs |
| Resumable workflows | Save job state, resume polling, and download results |
| Local GLB tools | Inspect models, resize textures by material slot, and optimize assets |
| Blender integration | Normalize dimensions and orientation; export a model, asset manifest, and previews |

## Installation

Requires **Node.js 20+**.

```bash
npm i -g hunyuan3d
hunyuan3d --help
hunyuan3d doctor
```

Or install in a project and run with `npx`:

```bash
npm i hunyuan3d
npx hunyuan3d --help
```

The package provides a command-line interface. A stable JavaScript API is not currently provided.

## Credentials

Cloud jobs require your own Tencent Cloud account, AI3D service access, and a **SecretId + SecretKey** pair. On macOS, save credentials in Keychain:

```bash
hunyuan3d auth login
hunyuan3d auth status
```

`auth login` prompts for missing values. At each hidden `password:` prompt, enter the requested SecretId or SecretKey. Existing valid entries are retained. `auth status` reports credential availability without printing secrets; `auth logout` removes this tool's two Tencent Cloud Keychain entries.

For other platforms or CI, supply `TENCENTCLOUD_SECRET_ID` and `TENCENTCLOUD_SECRET_KEY` through environment variables or a secret manager. `TENCENTCLOUD_REGION` defaults to `ap-guangzhou`. Keep credentials out of request JSON and command arguments.

## Quick start

### Generate a model from text

Save this as `request.json`:

```json
{
  "Prompt": "A simple wooden chair",
  "ResultFormat": "GLB",
  "EnablePBR": true
}
```

```bash
# Validate locally without submitting a cloud job.
hunyuan3d validate rapid request.json

# Submit, wait, and download. This step may incur Tencent Cloud charges.
hunyuan3d generate rapid request.json --out runs/chair --confirm-spend

# Resume polling and downloading after an interruption.
hunyuan3d resume --out runs/chair
```

Results are downloaded to `runs/chair/vendor/`. Cloud submissions require `--confirm-spend`. If the submission outcome is uncertain, the tool records `UNKNOWN_SUBMISSION` and does not automatically resubmit; check the cloud job before taking further action.

### Process an existing GLB

Local inspection and texture resizing do not require Tencent Cloud credentials:

```bash
hunyuan3d asset inspect --input model.glb
hunyuan3d asset resize-textures --input model.glb --out model-textures.glb \
  --base-color 1024 --normal 1024 --metallic-roughness 512
hunyuan3d asset optimize --input model.glb --out model-web.glb --profile web
```

Texture resizing writes a new file and lets you control sizes by material slot. For normalization and previews with `asset normalize`, install Blender separately and optionally set its path with `--blender` or `BLENDER_BIN`.

See [SDK request examples](docs/sdk-requests.md) for operation parameters and [asset handoff](docs/handoff.md) for Blender output and manifests. Detailed command usage follows below.

## Operations

`hunyuan3d operations` lists all supported SDK actions and their Tencent Cloud guides:

| Name | SDK submit / query pair |
| --- | --- |
| `pro` | `SubmitHunyuanTo3DProJob` / `QueryHunyuanTo3DProJob` |
| `rapid` | `SubmitHunyuanTo3DRapidJob` / `QueryHunyuanTo3DRapidJob` |
| `texture` | `SubmitTextureTo3DJob` / `DescribeTextureTo3DJob` |
| `reduce-face` | `SubmitReduceFaceJob` / `DescribeReduceFaceJob` |
| `parts` | `SubmitHunyuan3DPartJob` / `QueryHunyuan3DPartJob` |
| `uv` | `SubmitHunyuanTo3DUVJob` / `DescribeHunyuanTo3DUVJob` |
| `motion` | `SubmitHunyuanTo3DMotionJob` / `DescribeHunyuanTo3DMotionJob` |
| `rig` | `SubmitAutoRiggingJob` / `DescribeAutoRiggingJob` |
| `profile` | `SubmitProfileTo3DJob` / `DescribeProfileTo3DJob` |

The synchronous `Convert3DFormat` action uses `hunyuan3d convert`. This covers the [19 AI3D API actions](https://cloud.tencent.com/document/api/1804/120838) shown in the official API overview. Requests use the SDK's exact **PascalCase** parameter names; [parameter examples](docs/sdk-requests.md) show every operation. `hunyuan3d validate` checks fields and common documented constraints locally without credentials or billing. Cloud billing and image/3D file suitability still require a real account and service validation.

### Generate a professional 3D model from local views

Save `request.json` next to the pictures:

```json
{
  "Model": "3.1",
  "ImageBase64": "@front.png",
  "MultiViewImages": [
    { "ViewType": "left", "ViewImageBase64": "@left.png" },
    { "ViewType": "back", "ViewImageBase64": "@back.png" },
    { "ViewType": "top", "ViewImageBase64": "@top.png" }
  ],
  "EnablePBR": true,
  "FaceCount": 25000,
  "GenerateType": "Normal"
}
```

The `@file` shorthand works for any SDK field whose name ends in `Base64`, including nested `Image.Base64`, `Profile.Base64`, and `ViewImageBase64`. Files are read relative to the request JSON. Multi-view Base64 images have a combined limit of 6 MiB decoded / 8 MiB encoded; the service also checks dimensions and format. A local 3D mesh cannot be passed as `@file` to `File3D.Url` or `File.Url`: those API inputs require a Tencent-accessible HTTPS URL.

```bash
hunyuan3d validate pro request.json
hunyuan3d generate pro request.json --out runs/chair --confirm-spend
hunyuan3d resume --out runs/chair
```

`generate` submits once, saves the JobId, polls, and downloads results. Optional `--asset-id`, `--version`, `--source-front`, and `--target-size` flags normalize a returned GLB with Blender. To control the stages separately:

```bash
hunyuan3d submit pro request.json --state runs/chair/job.json --confirm-spend
hunyuan3d status --state runs/chair/job.json
hunyuan3d result --state runs/chair/job.json
hunyuan3d download --state runs/chair/job.json --out runs/chair/vendor
```

Replace `pro` with any operation name above. A submit refuses to overwrite an existing state file. If a request times out without a definitive API rejection, the state is marked `UNKNOWN_SUBMISSION` and the tool will not automatically repeat a potentially billable call. Query failures report the SDK error code, message, and RequestId when supplied. Completed result URLs usually expire after 24 hours; download promptly.

`result` prints completed result URLs for chaining into another SDK operation. Those URLs are temporary; the owner-only state file retains the original response.

### Format conversion

The cloud conversion API requires an HTTPS URL, for example `{"File3D":"https://example.com/model.glb","Format":"FBX"}`.

```bash
hunyuan3d validate convert convert.json
hunyuan3d convert convert.json --state runs/convert/job.json --confirm-spend
hunyuan3d download --state runs/convert/job.json --out runs/convert/vendor
```

For a local GLB/glTF, use the bundled glTF-Transform commands below instead of uploading it just to convert locally.

## Local GLB tools

```bash
hunyuan3d asset inspect --input model.glb
hunyuan3d asset resize-textures --input model.glb --out model-textures.glb \
  --base-color 1024 --normal 1024 --metallic-roughness 512
hunyuan3d asset optimize --input model.glb --out model-web.glb --profile web
hunyuan3d asset normalize --input model.glb --out assets/chair/v1 --asset-id chair --version 1 --source-front +Y --target-size 0.7 0.7 1.1
```

`asset resize-textures` uses glTF Transform's NodeIO plus Sharp to resize embedded PNG/JPEG textures by material slot. Set one or more of `--base-color`, `--normal`, `--metallic-roughness`, `--occlusion`, and `--emissive` (pixel limits); unspecified slots remain unchanged. It preserves the source GLB and validates the new GLB. If a texture is shared between configured and unconfigured slots, specify both sizes. Choose sizes by inspecting appearance: normal maps cannot restore color detail lost from a smaller base color texture.

`asset optimize --profile web` can alter geometry, textures, and Meshopt compression. Inspect the output in the target WebGL renderer. `asset normalize` uses Blender and emits `model.glb`, `asset.json`, and four previews; see [handoff](docs/handoff.md). For precise Draco/KTX2/WebP options, use the bundled glTF-Transform CLI directly.

For development, install dependencies from the source checkout with `npm ci`, then run `npm test` for offline request, state, error, and download checks. No test makes a billable call.
