// Tencent Cloud AI3D v20250513. Parameter names match the official Node SDK.
// Keep this list in sync with the SDK's ai3d_models.d.ts when upgrading it.
export const operations = Object.freeze({
  pro: {
    submit: 'SubmitHunyuanTo3DProJob', query: 'QueryHunyuanTo3DProJob',
    fields: ['Model', 'Prompt', 'ImageBase64', 'ImageUrl', 'MultiViewImages', 'EnablePBR',
      'FaceCount', 'GenerateType', 'PolygonType', 'ResultFormat'],
    guide: 'https://cloud.tencent.com/document/api/1804/123447',
  },
  rapid: {
    submit: 'SubmitHunyuanTo3DRapidJob', query: 'QueryHunyuanTo3DRapidJob',
    fields: ['Prompt', 'ImageBase64', 'ImageUrl', 'ResultFormat', 'EnablePBR', 'EnableGeometry'],
    guide: 'https://cloud.tencent.com/document/api/1804/123463',
  },
  texture: {
    submit: 'SubmitTextureTo3DJob', query: 'DescribeTextureTo3DJob',
    fields: ['File3D', 'Model', 'MultiViewImages', 'Prompt', 'Image', 'EnablePBR',
      'EnableKeepUV', 'TextureSize'],
    required: ['File3D'], guide: 'https://cloud.tencent.com/document/api/1804/126292',
  },
  'reduce-face': {
    submit: 'SubmitReduceFaceJob', query: 'DescribeReduceFaceJob',
    fields: ['File3D', 'PolygonType', 'FaceLevel'], required: ['File3D'],
    guide: 'https://cloud.tencent.com/document/api/1804/126293',
  },
  parts: {
    submit: 'SubmitHunyuan3DPartJob', query: 'QueryHunyuan3DPartJob',
    fields: ['File', 'Model', 'PartSegmentationInfo', 'EnableStagedGeneration', 'EnablePostProcess'],
    guide: 'https://cloud.tencent.com/document/api/1804/126295',
  },
  uv: {
    submit: 'SubmitHunyuanTo3DUVJob', query: 'DescribeHunyuanTo3DUVJob',
    fields: ['File'], guide: 'https://cloud.tencent.com/document/api/1804/126294',
  },
  motion: {
    submit: 'SubmitHunyuanTo3DMotionJob', query: 'DescribeHunyuanTo3DMotionJob',
    fields: ['Prompt', 'Model', 'RetargetFile', 'Duration', 'EnableMesh', 'EnableRewrite',
      'EnableDurationEst'], required: ['Prompt'],
    guide: 'https://cloud.tencent.com/document/api/1804/131256',
  },
  rig: {
    submit: 'SubmitAutoRiggingJob', query: 'DescribeAutoRiggingJob',
    fields: ['File3D', 'MotionType'], required: ['File3D'],
    guide: 'https://cloud.tencent.com/document/api/1804/131618',
  },
  profile: {
    submit: 'SubmitProfileTo3DJob', query: 'DescribeProfileTo3DJob',
    fields: ['Profile', 'Template'], guide: 'https://cloud.tencent.com/document/api/1804/127685',
  },
});

export const conversion = Object.freeze({
  action: 'Convert3DFormat', fields: ['File3D', 'Format'], required: ['File3D', 'Format'],
  guide: 'https://cloud.tencent.com/document/api/1804/126300',
});

export function resolveOperation(value) {
  const name = value ?? 'pro';
  const entry = operations[name] ?? Object.values(operations).find((item) => item.submit === name);
  if (!entry) throw new Error(`unknown operation: ${name}; run hunyuan3d operations`);
  return { name: operations[name] ? name : Object.keys(operations).find((key) => operations[key] === entry),
    ...entry };
}
