# hunyuan3d

[English](README.md) | [简体中文](README.zh-CN.md)

在终端中通过文字或图片生成 3D 模型，管理云端任务，并处理适用于网页、游戏和 Blender 的 GLB 资产。

`hunyuan3d` 将腾讯云 AI3D 生成与本地模型处理整合到一个 CLI 中。云端操作使用腾讯云官方 AI3D Node SDK，本地处理使用 glTF-Transform、Sharp 和可选的 Blender 集成。本项目是独立的 CLI 工具。

## 从参考图到可交互场景

下面的横向流程图使用 0918 场景的真实素材，展示输入图、单体参考、多视图、模型、Blender 组装，以及最终网页效果。点击图片可以查看大图。

[![从参考图、单体拆分、多视图和模型生成，到 Blender 组装、导出与交互网页的横向流程图](https://raw.githubusercontent.com/neciszhang/hunyuan3d/main/docs/assets/workflow-zh-cn.png)](https://github.com/neciszhang/hunyuan3d/blob/main/docs/assets/workflow-zh-cn.png)

**CLI 负责的范围：**云端任务提交、查询、下载，以及本地资产处理。参考图制作、完整场景组装、动画制作与网页交互由其他工具完成。图中使用历史素材说明完整工作流，不代表这些旧资产由当前 CLI 版本生成。

[中文流程说明](https://github.com/neciszhang/hunyuan3d/blob/main/docs/workflow.zh-CN.md) · [English workflow](https://github.com/neciszhang/hunyuan3d/blob/main/docs/workflow.md)

## 功能

| 功能 | 能做什么 |
| --- | --- |
| 文生 / 图生 3D | 使用 Pro 或 Rapid 生成模型；Pro 支持多视图输入 |
| 云端模型处理 | 生成纹理、减面、生成组件、展开 UV |
| 角色与动画 | 提交角色生成、自动绑骨、文字生成动作任务 |
| 任务恢复 | 保存任务状态，恢复轮询并下载结果 |
| 本地 GLB 工具 | 检查模型、按材质槽调整纹理尺寸、优化资产 |
| Blender 集成 | 统一尺寸和朝向，导出模型、资产清单与预览图 |

## 安装

需要 **Node.js 20.9+**。

```bash
npm i -g @neciszhang/hunyuan3d
hunyuan3d --help
hunyuan3d doctor
```

也可以安装到项目中，通过 `npx` 运行：

```bash
npm i @neciszhang/hunyuan3d
npx hunyuan3d --help
```

本包提供命令行接口，目前不提供稳定的 JavaScript API。

## 配置凭证

云端任务需要你自己的腾讯云账号、AI3D 服务权限，以及 **SecretId + SecretKey**。macOS 可以将凭证保存到系统钥匙串：

```bash
hunyuan3d auth login
hunyuan3d auth status
```

`auth login` 会提示补充缺失的值。在隐藏的 `password:` 提示处输入对应的 SecretId 或 SecretKey，已有的有效凭证会保留。`auth status` 只显示凭证是否可用，不输出密钥；`auth logout` 删除本工具的两条腾讯云钥匙串记录。

其他平台或 CI 可通过环境变量或密钥管理器提供 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`。`TENCENTCLOUD_REGION` 默认是 `ap-guangzhou`。不要把密钥放进请求 JSON 或命令参数中。

## 快速开始

### 用文字生成模型

保存为 `request.json`：

```json
{
  "Prompt": "A simple wooden chair",
  "ResultFormat": "GLB",
  "EnablePBR": true
}
```

```bash
# 本地校验，不提交云端任务。
hunyuan3d validate rapid request.json

# 提交、等待并下载；这一步可能产生腾讯云费用。
hunyuan3d generate rapid request.json --out runs/chair --confirm-spend

# 中断后继续查询和下载。
hunyuan3d resume --out runs/chair
```

结果下载到 `runs/chair/vendor/`。云端提交需要 `--confirm-spend`。如果无法确定提交是否成功，工具会记录 `UNKNOWN_SUBMISSION`，不会自动重复提交；应先检查云端任务状态。

### 处理已有 GLB

本地检查和纹理缩放不需要腾讯云凭证：

```bash
hunyuan3d asset inspect --input model.glb
hunyuan3d asset resize-textures --input model.glb --out model-textures.glb \
  --base-color 1024 --normal 1024 --metallic-roughness 512
hunyuan3d asset optimize --input model.glb --out model-web.glb --profile web
```

纹理缩放会写入新文件，并支持按材质槽设置尺寸。使用 `asset normalize` 统一尺寸和生成预览时，需要另行安装 Blender；可通过 `--blender` 或 `BLENDER_BIN` 指定路径。

操作参数见 [SDK 请求示例](docs/sdk-requests.md)，Blender 输出和清单见 [资产交付说明](docs/handoff.md)。这两份技术参考目前为英文。

## 云端操作

`hunyuan3d operations` 列出支持的 SDK 操作及腾讯云文档：

| 名称 | SDK 提交 / 查询接口 |
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

同步接口 `Convert3DFormat` 通过 `hunyuan3d convert` 调用。上述操作覆盖官方概览中的 [19 个 AI3D API 接口](https://cloud.tencent.com/document/api/1804/120838)。请求使用 SDK 的原始 **PascalCase** 字段名；[参数示例](docs/sdk-requests.md) 包含各操作的请求格式。`validate` 可以在无凭证、无计费的情况下检查字段及常见约束；实际计费和图片 / 3D 文件是否适用仍由云端服务判断。

### 使用本地多视图生成 Pro 模型

将 `request.json` 放在图片旁边：

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

`@file` 可用于字段名以 `Base64` 结尾的 SDK 字段，包括嵌套的 `Image.Base64`、`Profile.Base64`、`ViewImageBase64`。文件路径相对于请求 JSON 解析。多视图 Base64 图片合计限制为解码后 6 MiB / 编码后 8 MiB；服务还会检查尺寸和格式。`File3D.Url`、`File.Url` 要求腾讯云可访问的 HTTPS URL，不能直接使用本地模型的 `@file` 路径。

```bash
hunyuan3d validate pro request.json
hunyuan3d generate pro request.json --out runs/chair --confirm-spend
hunyuan3d resume --out runs/chair
```

`generate` 提交一次任务、保存 JobId、轮询并下载结果。可选参数 `--asset-id`、`--version`、`--source-front`、`--target-size` 可以通过 Blender 规范化返回的 GLB。也可以分别执行各阶段：

```bash
hunyuan3d submit pro request.json --state runs/chair/job.json --confirm-spend
hunyuan3d status --state runs/chair/job.json
hunyuan3d result --state runs/chair/job.json
hunyuan3d download --state runs/chair/job.json --out runs/chair/vendor
```

将 `pro` 替换为上表中的其他操作名即可。`submit` 拒绝覆盖已有状态文件。请求超时且没有明确的 API 拒绝时，状态标记为 `UNKNOWN_SUBMISSION`，不会自动重复可能计费的调用。查询失败时会显示 SDK 错误码、消息，以及服务提供的 RequestId。结果 URL 通常在 24 小时后过期，请及时下载。

`result` 输出已完成任务的结果 URL，可用于后续 SDK 操作。这些 URL 是临时的；仅所有者可访问的状态文件保留原始响应。

### 格式转换

云端转换需要 HTTPS URL，例如 `{"File3D":"https://example.com/model.glb","Format":"FBX"}`。

```bash
hunyuan3d validate convert convert.json
hunyuan3d convert convert.json --state runs/convert/job.json --confirm-spend
hunyuan3d download --state runs/convert/job.json --out runs/convert/vendor
```

已有本地 GLB/glTF 时，可直接使用随包提供的 glTF-Transform 工具进行本地处理。

## 本地 GLB 工具

```bash
hunyuan3d asset inspect --input model.glb
hunyuan3d asset resize-textures --input model.glb --out model-textures.glb \
  --base-color 1024 --normal 1024 --metallic-roughness 512
hunyuan3d asset optimize --input model.glb --out model-web.glb --profile web
hunyuan3d asset normalize --input model.glb --out assets/chair/v1 --asset-id chair --version 1 --source-front +Y --target-size 0.7 0.7 1.1
```

`asset resize-textures` 使用 glTF-Transform 的 NodeIO 和 Sharp，按材质槽缩放嵌入的 PNG/JPEG 纹理。可以设置 `--base-color`、`--normal`、`--metallic-roughness`、`--occlusion`、`--emissive` 中的一个或多个尺寸上限，未指定的槽位保持原样。工具保留原 GLB 并校验新文件。如果同一纹理由已配置与未配置的槽位共享，需要同时指定尺寸。纹理尺寸应根据实际外观选择：法线贴图无法恢复低分辨率基础颜色贴图损失的颜色细节。

`asset optimize --profile web` 可能改变几何、纹理及 Meshopt 压缩方式，应在目标 WebGL 渲染器中检查结果。`asset normalize` 使用 Blender，输出 `model.glb`、`asset.json` 和四张预览图，详见 [交付说明](docs/handoff.md)。需要精确控制 Draco/KTX2/WebP 时，可以直接使用随包提供的 glTF-Transform CLI。

## 本地开发

在源码目录运行 `npm ci` 安装依赖，再运行 `npm test`，检查离线请求、状态、错误处理和下载逻辑。测试不会发起计费调用。
