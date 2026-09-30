import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assert, prepareRequest } from './request.js';
import { atomicJSON } from './io.js';
import { download, loadState, query, submit, submissionError } from './cloud-sdk.js';
import { resolveCredentials } from './credentials.js';
import { resolveOperation } from './operations.js';
import { normalizeAsset } from './assets.js';

const WORKFLOW_SCHEMA = 'hunyuan-workflow.v1';
const DEFAULT_POLL_MS = 15000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function workflowPath(out) { return join(out, 'workflow.json'); }
function statePath(out) { return join(out, 'job.json'); }
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

export async function generate(kind, requestPath, out, asset, deps = {}) {
  out = resolve(out);
  const operation = resolveOperation(kind);
  prepareRequest(operation.name, requestPath);
  if (!deps.submit) resolveCredentials();
  assert(!existsSync(out) || readdirSync(out).length === 0, 'output directory must be new or empty');
  mkdirSync(out, { recursive: true });
  atomicJSON(workflowPath(out), { schema: WORKFLOW_SCHEMA, kind: operation.name, asset: asset ?? null });
  const submitted = await (deps.submit ?? submit)(operation.name, requestPath, statePath(out));
  const result = await resume(out, deps);
  return { ...result, jobId: submitted.jobId };
}

export async function resume(out, deps = {}) {
  out = resolve(out);
  const workflow = JSON.parse(readFileSync(workflowPath(out), 'utf8'));
  assert(workflow.schema === WORKFLOW_SCHEMA, 'invalid workflow file');
  const load = deps.loadState ?? loadState;
  const queryJob = deps.query ?? query;
  const downloadJob = deps.download ?? download;
  const rejected = deps.submissionError ?? submissionError;
  const stateFile = statePath(out);
  let state = load(stateFile);
  if (state.status === 'REJECTED') throw rejected(state);
  assert(state.jobId, 'submission outcome uncertain; reconcile job id before resuming');
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  while (state.status !== 'DONE') {
    const result = await queryJob(stateFile);
    if (result.status === 'FAIL') throw new Error(`Tencent generation failed: ${result.errorCode ?? 'unknown'}${result.errorMessage ? `: ${result.errorMessage}` : ''}${result.requestId ? ` (request_id: ${result.requestId})` : ''}`);
    state = load(stateFile);
    if (state.status === 'DONE') break;
    assert(Date.now() + pollMs < deadline, 'generation still running; use hunyuan3d resume later');
    await (deps.pause ?? pause)(pollMs);
  }
  const vendor = join(out, 'vendor');
  let manifest;
  if (existsSync(join(vendor, 'download_manifest.json'))) {
    manifest = JSON.parse(readFileSync(join(vendor, 'download_manifest.json'), 'utf8'));
  } else {
    assert(!existsSync(vendor), 'incomplete vendor directory; inspect it before resuming');
    const staged = join(out, `.vendor-${randomUUID()}`);
    try {
      manifest = await downloadJob(stateFile, staged);
      renameSync(staged, vendor);
    } finally { if (existsSync(staged)) rmSync(staged, { recursive: true }); }
  }
  let assetPath = null;
  let assetStatus = null;
  if (workflow.asset) {
    const config = workflow.asset;
    const candidate = manifest.files.find((file) => file.path.toLowerCase().endsWith('.glb'));
    assert(candidate, 'vendor result has no GLB; downloaded files are preserved in vendor/');
    assetPath = join(out, 'asset', `v${config.version}`);
    if (!existsSync(join(assetPath, 'asset.json'))) {
      (deps.normalize ?? normalizeAsset)({ input: join(vendor, candidate.path), out: assetPath,
        sourceDir: vendor, sourceJobId: state.jobId, providerModel: state.model, ...config });
    }
    assetStatus = JSON.parse(readFileSync(join(assetPath, 'asset.json'), 'utf8')).status;
  }
  return { status: assetStatus ?? 'downloaded', jobId: state.jobId, vendor, asset: assetPath };
}
