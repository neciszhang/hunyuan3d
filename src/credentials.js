import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { assert } from './request.js';

const SECURITY = '/usr/bin/security';
const SERVICES = { secretId: 'hunyuan3d-tencent-secret-id', secretKey: 'hunyuan3d-tencent-secret-key' };
const account = () => process.env.USER || userInfo().username;

function readSecret(service, run = spawnSync) {
  const result = run(SECURITY, ['find-generic-password', '-a', account(), '-s', service, '-w'],
    { encoding: 'utf8', timeout: 10000 });
  return result.status === 0 ? result.stdout?.trim() : null;
}

export function resolveCredentials(options = {}) {
  const env = options.env ?? process.env;
  const id = env.TENCENTCLOUD_SECRET_ID, key = env.TENCENTCLOUD_SECRET_KEY;
  assert((id === undefined) === (key === undefined),
    'set both TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY');
  if (id !== undefined) {
    assert(id && key, 'Tencent Cloud credentials must be nonempty');
    return { secretId: id, secretKey: key, source: 'environment' };
  }
  if ((options.platform ?? process.platform) === 'darwin') {
    const savedId = readSecret(SERVICES.secretId, options.run);
    const savedKey = readSecret(SERVICES.secretKey, options.run);
    if (savedId && savedKey) return { secretId: savedId, secretKey: savedKey, source: 'macOS Keychain' };
  }
  throw new Error('Tencent Cloud credentials are missing; run hunyuan3d auth login or set both TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY');
}

export function authStatus(options = {}) {
  const env = options.env ?? process.env;
  const hasEnvId = !!env.TENCENTCLOUD_SECRET_ID;
  const hasEnvKey = !!env.TENCENTCLOUD_SECRET_KEY;
  if (env.TENCENTCLOUD_SECRET_ID !== undefined || env.TENCENTCLOUD_SECRET_KEY !== undefined)
    return { configured: hasEnvId && hasEnvKey, source: 'environment',
      secretIdConfigured: hasEnvId, secretKeyConfigured: hasEnvKey };
  if ((options.platform ?? process.platform) === 'darwin') {
    const hasId = !!readSecret(SERVICES.secretId, options.run);
    const hasKey = !!readSecret(SERVICES.secretKey, options.run);
    return { configured: hasId && hasKey, source: 'macOS Keychain',
      secretIdConfigured: hasId, secretKeyConfigured: hasKey };
  }
  return { configured: false, source: null, secretIdConfigured: false, secretKeyConfigured: false };
}

export function authLogin(options = {}) {
  assert((options.platform ?? process.platform) === 'darwin',
    'Keychain login supports macOS; set both Tencent Cloud environment variables elsewhere');
  assert(options.interactive ?? process.stdin.isTTY, 'auth login needs an interactive terminal');
  const run = options.run ?? spawnSync;
  for (const [name, service] of Object.entries(SERVICES)) {
    if (readSecret(service, run)) continue;
    const label = name === 'secretId' ? 'SecretId (usually starts with AKID)' : 'SecretKey';
    process.stderr.write(`Enter Tencent Cloud ${label} at the hidden macOS Keychain password prompt, then press Enter.\n`);
    const result = run(SECURITY, ['add-generic-password', '-a', account(), '-s', service, '-U', '-w'],
      { stdio: 'inherit' });
    assert(result.status === 0, `Keychain did not save ${name}`);
    assert(readSecret(service, run), `${name} was saved empty; run hunyuan3d auth login again`);
  }
  assert(readSecret(SERVICES.secretId, run) && readSecret(SERVICES.secretKey, run),
    'saved Tencent Cloud credentials are missing');
  return { configured: true, source: 'macOS Keychain' };
}

export function authLogout(options = {}) {
  assert((options.platform ?? process.platform) === 'darwin', 'Keychain logout supports macOS');
  const run = options.run ?? spawnSync;
  for (const service of Object.values(SERVICES))
    run(SECURITY, ['delete-generic-password', '-a', account(), '-s', service],
      { encoding: 'utf8', timeout: 10000 });
  return { configured: false, source: 'macOS Keychain' };
}
