import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { conversion, resolveOperation } from './operations.js';

export function assert(ok, message) { if (!ok) throw new Error(message); }
export function httpsUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an HTTPS URL`); }
  assert(url.protocol === 'https:' && !!url.hostname, `${label} must be an HTTPS URL`);
}

function expand(value, base, key = '') {
  if (Array.isArray(value)) return value.map((item) => expand(item, base, key));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name, expand(item, base, name)]));
  if (typeof value === 'string' && value.startsWith('@')) {
    assert(key.endsWith('Base64'), `${key}: @file works only for Base64; 3D inputs need an HTTPS URL`);
    const file = resolve(base, value.slice(1)), stat = statSync(file);
    assert(stat.isFile() && stat.size <= 10 * 1024 * 1024, `${key}: file must be at most 10 MiB`);
    return readFileSync(file).toString('base64');
  }
  return value;
}

function base64(value, label, max = 10 * 1024 * 1024) {
  assert(typeof value === 'string' && value.length > 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
  `${label} must be valid Base64`);
  assert(Buffer.from(value, 'base64').length <= max, `${label} exceeds its size limit`);
}

function primary(body, limit, sketch = false) {
  const p = body.Prompt !== undefined, b = body.ImageBase64 !== undefined, u = body.ImageUrl !== undefined;
  assert(p || b || u, 'Prompt, ImageBase64, or ImageUrl is required');
  assert(!(b && u), 'ImageBase64 and ImageUrl are mutually exclusive');
  assert(sketch || !(p && (b || u)), 'Prompt and image are mutually exclusive outside Sketch');
  if (p) assert(typeof body.Prompt === 'string' && body.Prompt.length > 0 &&
    [...body.Prompt].length <= limit, `Prompt must contain 1-${limit} characters`);
  if (b) base64(body.ImageBase64, 'ImageBase64', 6 * 1024 * 1024);
  if (u) httpsUrl(body.ImageUrl, 'ImageUrl');
}

function views(body, kind) {
  if (body.MultiViewImages === undefined) return;
  assert(kind === 'pro' || kind === 'texture', 'MultiViewImages is unsupported here');
  assert(Array.isArray(body.MultiViewImages) && body.MultiViewImages.length > 0,
    'MultiViewImages must be a nonempty array');
  if (kind === 'texture') assert(body.Model === '3.1', 'Texture MultiViewImages requires Model 3.1');
  const seen = new Set(), valid = new Set(['left', 'right', 'back', 'top', 'bottom', 'left_front', 'right_front']);
  let encoded = 0, decoded = 0;
  for (const [i, view] of body.MultiViewImages.entries()) {
    const name = `MultiViewImages[${i}]`;
    assert(view && typeof view === 'object' && !Array.isArray(view), `${name} must be an object`);
    assert(Object.keys(view).every((key) => ['ViewType', 'ViewImageBase64', 'ViewImageUrl'].includes(key)),
      `${name} has an unsupported field`);
    assert(valid.has(view.ViewType) && !seen.has(view.ViewType), `${name}.ViewType is invalid or duplicated`);
    if (kind === 'pro' && body.Model !== '3.1')
      assert(['left', 'right', 'back'].includes(view.ViewType), `${name}.ViewType requires Model 3.1`);
    seen.add(view.ViewType);
    assert((view.ViewImageBase64 !== undefined) !== (view.ViewImageUrl !== undefined),
      `${name} needs exactly one ViewImageBase64 or ViewImageUrl`);
    if (view.ViewImageBase64 !== undefined) {
      base64(view.ViewImageBase64, `${name}.ViewImageBase64`);
      encoded += view.ViewImageBase64.length;
      decoded += Buffer.from(view.ViewImageBase64, 'base64').length;
    } else httpsUrl(view.ViewImageUrl, `${name}.ViewImageUrl`);
  }
  assert(encoded <= 8 * 1024 * 1024 && decoded <= 6 * 1024 * 1024,
    'MultiViewImages exceeds 8 MiB encoded or 6 MiB decoded');
}

function file3D(value, name, types) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
  assert(types.includes(value.Type), `${name}.Type must be ${types.join(', ')}`);
  httpsUrl(value.Url, `${name}.Url`);
}

function specific(kind, b) {
  if (kind === 'pro') {
    assert(b.Model === undefined || ['3.0', '3.1'].includes(b.Model), 'Model must be 3.0 or 3.1');
    const mode = b.GenerateType ?? 'Normal';
    assert(['Normal', 'LowPoly', 'Geometry', 'Sketch'].includes(mode), 'invalid GenerateType');
    assert(!(b.Model === '3.1' && mode === 'LowPoly'), 'Model 3.1 does not support LowPoly');
    primary(b, 1024, mode === 'Sketch'); views(b, kind);
    if (b.FaceCount !== undefined) assert(Number.isInteger(b.FaceCount) && b.FaceCount >= 3000 &&
      b.FaceCount <= 1500000, 'FaceCount must be 3000-1500000');
    if (b.ResultFormat !== undefined) assert(['STL', 'USDZ', 'FBX'].includes(b.ResultFormat),
      'ResultFormat must be STL, USDZ, or FBX');
  } else if (kind === 'rapid') {
    primary(b, 200);
    if (b.ResultFormat !== undefined) assert(['OBJ', 'GLB', 'STL', 'USDZ', 'FBX', 'MP4'].includes(b.ResultFormat),
      'invalid Rapid ResultFormat');
    assert(!(b.EnableGeometry === true && b.ResultFormat === 'OBJ'), 'EnableGeometry does not support OBJ');
  } else if (kind === 'texture') {
    file3D(b.File3D, 'File3D', ['OBJ', 'GLB']);
    assert(b.Prompt !== undefined || b.Image !== undefined, 'Texture needs Prompt or Image');
    if (b.Image !== undefined) {
      assert(b.Image && (b.Image.Base64 !== undefined || b.Image.Url !== undefined), 'Image needs Base64 or Url');
      if (b.Image.Base64 !== undefined) base64(b.Image.Base64, 'Image.Base64');
      if (b.Image.Url !== undefined) httpsUrl(b.Image.Url, 'Image.Url');
    }
    views(b, kind);
    if (b.TextureSize !== undefined) assert(Number.isInteger(b.TextureSize) &&
      b.TextureSize >= 720 && b.TextureSize <= 4096, 'TextureSize must be 720-4096');
  } else if (kind === 'reduce-face') file3D(b.File3D, 'File3D', ['OBJ', 'GLB', 'FBX']);
  else if (kind === 'parts') file3D(b.File, 'File', ['FBX']);
  else if (kind === 'uv') file3D(b.File, 'File', ['FBX', 'OBJ', 'GLB']);
  else if (kind === 'motion') {
    assert(typeof b.Prompt === 'string' && b.Prompt.length > 0 && [...b.Prompt].length <= 128,
      'Motion Prompt must contain 1-128 characters');
    if (b.Duration !== undefined) assert(Number.isInteger(b.Duration) && b.Duration >= 1 &&
      b.Duration <= 12, 'Duration must be 1-12 seconds');
    if (b.RetargetFile !== undefined) file3D(b.RetargetFile, 'RetargetFile', ['FBX', 'GLB']);
  } else if (kind === 'rig') file3D(b.File3D, 'File3D', ['FBX', 'GLB']);
  else if (kind === 'profile') {
    assert(b.Profile && (b.Profile.Base64 !== undefined || b.Profile.Url !== undefined),
      'Profile needs Base64 or Url');
    if (b.Profile.Base64 !== undefined) base64(b.Profile.Base64, 'Profile.Base64');
    if (b.Profile.Url !== undefined) httpsUrl(b.Profile.Url, 'Profile.Url');
  } else if (kind === 'convert') {
    httpsUrl(b.File3D, 'File3D');
    assert(['STL', 'USDZ', 'FBX', 'MP4', 'GIF'].includes(b.Format), 'invalid conversion Format');
  }
}

export function prepareRequest(kind, source) {
  const entry = kind === 'convert' ? conversion : resolveOperation(kind);
  const raw = JSON.parse(readFileSync(source, 'utf8'));
  assert(raw && typeof raw === 'object' && !Array.isArray(raw), 'request must be a JSON object');
  const body = expand(raw, dirname(source));
  for (const key of Object.keys(body)) assert(entry.fields.includes(key),
    `${key} is not a ${kind} SDK parameter; use PascalCase`);
  for (const key of entry.required ?? []) assert(body[key] !== undefined, `${key} is required`);
  specific(kind, body);
  return { body, action: entry.submit ?? entry.action, guide: entry.guide };
}
