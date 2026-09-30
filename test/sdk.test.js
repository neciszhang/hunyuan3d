import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { convert, download, loadState, query, result, submit } from '../src/cloud-sdk.js';
import { operations, conversion } from '../src/operations.js';
import { prepareRequest } from '../src/request.js';
import { authLogin, authLogout, authStatus, resolveCredentials } from '../src/credentials.js';
import { generate, resume } from '../src/workflow.js';

const require = createRequire(import.meta.url);
const sdk = require('tencentcloud-sdk-nodejs-ai3d');
const url = 'https://example.com/asset.glb';
const file = { Type: 'GLB', Url: url };
const requestFile = (data) => {
  const dir = mkdtempSync(join(tmpdir(), 'hunyuan-sdk-'));
  const path = join(dir, 'request.json');
  writeFileSync(path, JSON.stringify(data));
  return { dir, path };
};

test('catalog actions and top-level fields match the installed official SDK', () => {
  const proto = sdk.ai3d.v20250513.Client.prototype;
  const types = readFileSync(require.resolve('tencentcloud-sdk-nodejs-ai3d').replace(
    /tencentcloud\/index\.js$/, 'tencentcloud/services/ai3d/v20250513/ai3d_models.d.ts'), 'utf8');
  for (const operation of [...Object.values(operations), { submit: conversion.action, fields: conversion.fields }]) {
    assert.equal(typeof proto[operation.submit], 'function', operation.submit);
    if (operation.query) assert.equal(typeof proto[operation.query], 'function', operation.query);
    const match = types.match(new RegExp(`export interface ${operation.submit}Request \\{([\\s\\S]*?)^\\}`, 'm'));
    assert.ok(match, `${operation.submit}Request`);
    const block = match[1].replace(/\/\*[\s\S]*?\*\//g, '');
    const sdkFields = [...block.matchAll(/^\s+(\w+)\??:/gm)].map((item) => item[1]);
    assert.deepEqual(operation.fields, sdkFields, operation.submit);
  }
});

test('all nine job request forms validate with SDK parameter names', () => {
  const cases = {
    pro: { Model: '3.1', Prompt: '一把木椅', FaceCount: 25000 },
    rapid: { Prompt: '一把木椅', ResultFormat: 'GLB' },
    texture: { File3D: file, Model: '3.1', Prompt: '红色木纹', TextureSize: 2048 },
    'reduce-face': { File3D: file, FaceLevel: 'low' },
    parts: { File: { Type: 'FBX', Url: 'https://example.com/a.fbx' }, EnableStagedGeneration: true },
    uv: { File: file },
    motion: { Prompt: 'A person walks forward', Duration: 5 },
    rig: { File3D: file, MotionType: 1 },
    profile: { Profile: { Base64: Buffer.from('portrait').toString('base64') }, Template: 'basketball' },
  };
  for (const [kind, body] of Object.entries(cases)) {
    const { path } = requestFile(body);
    assert.deepEqual(prepareRequest(kind, path).body, body);
  }
});

test('local multi-view images become Base64, with 3.1 view and casing checks', () => {
  const { dir, path } = requestFile({ Model: '3.1', ImageBase64: '@front.png',
    MultiViewImages: [{ ViewType: 'top', ViewImageBase64: '@top.png' }], FaceCount: 25000 });
  writeFileSync(join(dir, 'front.png'), 'front');
  writeFileSync(join(dir, 'top.png'), 'top');
  const { body } = prepareRequest('pro', path);
  assert.equal(body.ImageBase64, Buffer.from('front').toString('base64'));
  assert.equal(body.MultiViewImages[0].ViewImageBase64, Buffer.from('top').toString('base64'));
  writeFileSync(path, JSON.stringify({ Model: '3.0', ImageBase64: '@front.png',
    MultiViewImages: [{ ViewType: 'top', ViewImageBase64: '@top.png' }] }));
  assert.throws(() => prepareRequest('pro', path), /requires Model 3.1/);
  writeFileSync(path, JSON.stringify({ model: 'hy-3d-3.1', Prompt: '椅子' }));
  assert.throws(() => prepareRequest('pro', path), /PascalCase/);
});

test('submit, query, and download route all nine operations without duplicate submission', async () => {
  for (const kind of Object.keys(operations)) {
    const body = kind === 'pro' ? { Prompt: '椅子' } : kind === 'rapid' ? { Prompt: '椅子' }
      : kind === 'texture' ? { File3D: file, Prompt: '红色' }
        : kind === 'reduce-face' ? { File3D: file }
          : kind === 'parts' ? { File: { Type: 'FBX', Url: 'https://example.com/a.fbx' } }
            : kind === 'uv' ? { File: file }
              : kind === 'motion' ? { Prompt: 'A person walks' }
                : kind === 'rig' ? { File3D: file }
                  : { Profile: { Url: 'https://example.com/face.png' } };
    const { dir, path } = requestFile(body), statePath = join(dir, 'job.json');
    const op = operations[kind]; let calls = 0;
    const client = {
      async [op.submit](request) { calls++; assert.deepEqual(request, body);
        return { JobId: `${kind}-123`, RequestId: 'submit-req' }; },
      async [op.query]({ JobId }) { assert.equal(JobId, `${kind}-123`);
        return { Status: 'DONE', ResultFile3Ds: [{ Type: 'GLB', Url: url }], RequestId: 'query-req' }; },
    };
    await submit(kind, path, statePath, client);
    await assert.rejects(submit(kind, path, statePath, client), /state file exists/);
    assert.equal(calls, 1);
    assert.equal((await query(statePath, client)).status, 'DONE');
    assert.equal(result(statePath).files[0].url, url);
    const manifest = await download(statePath, join(dir, 'vendor'), async (_url, dest) => {
      writeFileSync(dest, 'model'); return 'hash';
    });
    assert.equal(manifest.files[0].path, 'vendor-0.glb');
    assert.equal(loadState(statePath).kind, kind);
  }
});

test('SDK errors retain request ID; transport failures stay uncertain', async () => {
  const { dir, path } = requestFile({ Prompt: '椅子' });
  const apiPath = join(dir, 'api.json');
  await assert.rejects(submit('pro', path, apiPath, { async SubmitHunyuanTo3DProJob() {
    throw Object.assign(new Error('bad image'), { code: 'InvalidParameter', requestId: 'req-123' });
  } }), /InvalidParameter.*req-123/);
  assert.equal(loadState(apiPath).status, 'REJECTED');
  const networkPath = join(dir, 'network.json');
  await assert.rejects(submit('pro', path, networkPath, { async SubmitHunyuanTo3DProJob() {
    throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
  } }), /UNKNOWN_SUBMISSION/);
  assert.equal(loadState(networkPath).status, 'UNKNOWN_SUBMISSION');
});

test('synchronous conversion saves a downloadable result', async () => {
  const { dir, path } = requestFile({ File3D: url, Format: 'FBX' });
  const statePath = join(dir, 'converted.json');
  await convert(path, statePath, { async Convert3DFormat(body) {
    assert.equal(body.Format, 'FBX');
    return { ResultFile3D: 'https://example.com/converted.fbx', RequestId: 'convert-req' };
  } });
  const manifest = await download(statePath, join(dir, 'converted'), async (_url, dest) => {
    writeFileSync(dest, 'fbx'); return 'hash';
  });
  assert.equal(manifest.files[0].path, 'vendor-0.fbx');
});

test('one-command workflow resumes a completed SDK job without resubmitting', async () => {
  const { dir, path } = requestFile({ Prompt: '一把木椅' });
  const out = join(dir, 'run'); let submissions = 0;
  const client = {
    async SubmitHunyuanTo3DProJob() { submissions++; return { JobId: 'job-1', RequestId: 'req-1' }; },
    async QueryHunyuanTo3DProJob() { return { Status: 'DONE',
      ResultFile3Ds: [{ Type: 'GLB', Url: url }], RequestId: 'req-2' }; },
  };
  const deps = {
    submit: (kind, request, state) => submit(kind, request, state, client),
    query: (state) => query(state, client),
    download: (state, dest) => download(state, dest, async (_url, target) => {
      writeFileSync(target, 'glb'); return 'hash';
    }),
  };
  assert.equal((await generate('pro', path, out, null, deps)).status, 'downloaded');
  assert.equal((await resume(out, deps)).status, 'downloaded');
  assert.equal(submissions, 1);
});

test('Tencent Cloud credential pair is resolved without TokenHub SK', () => {
  const resolved = resolveCredentials({ env: { TENCENTCLOUD_SECRET_ID: 'id',
    TENCENTCLOUD_SECRET_KEY: 'secret', TOKENHUB_API_KEY: 'sk-unused' }, platform: 'linux' });
  assert.equal(resolved.source, 'environment');
  assert.equal(resolved.secretId, 'id');
  assert.throws(() => resolveCredentials({ env: { TOKENHUB_API_KEY: 'sk-unused' }, platform: 'linux' }),
    /Tencent Cloud credentials are missing/);
});

test('macOS Keychain login stores two separate SDK credentials', () => {
  const calls = [], saved = new Map();
  const run = (_binary, args) => {
    calls.push(args);
    const service = args[args.indexOf('-s') + 1];
    if (args[0] === 'find-generic-password') return saved.has(service)
      ? { status: 0, stdout: `${saved.get(service)}\n` } : { status: 44, stdout: '' };
    if (args[0] === 'add-generic-password') saved.set(service, 'saved-value');
    if (args[0] === 'delete-generic-password') saved.delete(service);
    return { status: 0, stdout: '' };
  };
  assert.equal(authLogin({ platform: 'darwin', interactive: true, run }).configured, true);
  assert.equal(calls.filter((args) => args[0] === 'add-generic-password').length, 2);
  assert.equal(authStatus({ platform: 'darwin', env: {}, run }).configured, true);
  assert.equal(authLogout({ platform: 'darwin', run }).configured, false);
  assert.equal(calls.filter((args) => args[0] === 'delete-generic-password').length, 2);
});

test('Keychain login repairs only an empty SecretId and retains the saved SecretKey', () => {
  const idService = 'hunyuan3d-tencent-secret-id';
  const keyService = 'hunyuan3d-tencent-secret-key';
  const saved = new Map([[idService, ''], [keyService, 'existing-secret-key']]);
  const added = [];
  const run = (_binary, args) => {
    const service = args[args.indexOf('-s') + 1];
    if (args[0] === 'find-generic-password')
      return { status: 0, stdout: `${saved.get(service) ?? ''}\n` };
    if (args[0] === 'add-generic-password') { added.push(service); saved.set(service, 'new-secret-id'); }
    return { status: 0, stdout: '' };
  };
  assert.deepEqual(authStatus({ platform: 'darwin', env: {}, run }), {
    configured: false, source: 'macOS Keychain', secretIdConfigured: false, secretKeyConfigured: true,
  });
  assert.equal(authLogin({ platform: 'darwin', interactive: true, run }).configured, true);
  assert.deepEqual(added, [idService]);
  assert.equal(saved.get(keyService), 'existing-secret-key');
});
