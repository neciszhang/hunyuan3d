import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import sdk from 'tencentcloud-sdk-nodejs-ai3d';
import { resolveCredentials } from './credentials.js';
import { atomicJSON, downloadURL, readJSON } from './io.js';
import { conversion, resolveOperation } from './operations.js';
import { assert, httpsUrl, prepareRequest } from './request.js';

export const STATE_SCHEMA = 'tencent-cloud-ai3d-job.v2';
const { Client } = sdk.ai3d.v20250513;
const sha256 = (body) => createHash('sha256').update(JSON.stringify(body)).digest('hex');

export function makeClient() {
  const { secretId, secretKey } = resolveCredentials();
  return new Client({ credential: { secretId, secretKey },
    region: process.env.TENCENTCLOUD_REGION ?? 'ap-guangzhou',
    profile: { httpProfile: { endpoint: 'ai3d.tencentcloudapi.com', reqTimeout: 60 } } });
}

function errorInfo(error) {
  const message = String(error?.message ?? error)
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/AKID[A-Za-z0-9]{12,}/g, '[REDACTED]').slice(0, 1000);
  return { code: error?.code, message, requestId: error?.requestId ?? error?.request_id };
}

export function loadState(path) {
  assert(existsSync(path), `state file missing: ${path}`);
  const state = readJSON(path);
  assert(state?.schema === STATE_SCHEMA, 'invalid Tencent Cloud AI3D state file');
  return state;
}

export function submissionError(state) {
  return new Error(`${state.action} rejected: ${state.error?.code ?? 'unknown'}: ${state.error?.message ?? 'no message'}`);
}

function stateStart(kind, action, body) {
  return { schema: STATE_SCHEMA, provider: 'tencent-cloud-ai3d-sdk', kind, action,
    requestSha256: sha256(body), requestKeys: Object.keys(body).sort(),
    region: process.env.TENCENTCLOUD_REGION ?? 'ap-guangzhou',
    createdAt: new Date().toISOString(), status: 'SUBMITTING' };
}

function failSubmission(state, path, error) {
  const detail = errorInfo(error);
  Object.assign(state, { status: detail.code && detail.requestId ? 'REJECTED' : 'UNKNOWN_SUBMISSION',
    error: detail, requestId: detail.requestId });
  atomicJSON(path, state);
  return new Error(`${state.action} ${state.status}: ${detail.code ?? 'unknown'}: ${detail.message}` +
    (detail.requestId ? ` (RequestId: ${detail.requestId})` : ''));
}

export async function submit(kind, requestPath, statePath, client = null) {
  const operation = resolveOperation(kind);
  const { body } = prepareRequest(operation.name, resolve(requestPath));
  assert(!existsSync(statePath), 'state file exists; inspect it instead of resubmitting');
  client ??= makeClient();
  const state = stateStart(operation.name, operation.submit, body);
  atomicJSON(statePath, state);
  try {
    const response = await client[operation.submit](body);
    assert(response?.JobId, `${operation.submit} returned no JobId; submission may be uncertain`);
    Object.assign(state, { status: 'SUBMITTED', jobId: String(response.JobId), requestId: response.RequestId });
    atomicJSON(statePath, state);
    return { status: state.status, kind: operation.name, jobId: state.jobId, requestId: state.requestId };
  } catch (error) { throw failSubmission(state, statePath, error); }
}

export async function query(statePath, client = null) {
  const state = loadState(statePath);
  if (state.status === 'REJECTED') throw submissionError(state);
  assert(state.jobId, 'no JobId; reconcile uncertain submission before retrying');
  const operation = resolveOperation(state.kind);
  client ??= makeClient();
  let response;
  try { response = await client[operation.query]({ JobId: state.jobId }); }
  catch (error) {
    const detail = errorInfo(error);
    throw new Error(`${operation.query} failed: ${detail.code ?? 'unknown'}: ${detail.message}` +
      (detail.requestId ? ` (RequestId: ${detail.requestId})` : ''));
  }
  const vendorStatus = String(response?.Status ?? '').toUpperCase();
  assert(['WAIT', 'RUN', 'FAIL', 'DONE'].includes(vendorStatus),
    `unknown ${operation.query} status: ${vendorStatus || '(missing)'}`);
  Object.assign(state, { status: vendorStatus === 'WAIT' ? 'RUN' : vendorStatus,
    vendorStatus, lastQueryAt: new Date().toISOString(), requestId: response.RequestId });
  if (state.status !== 'RUN') state.result = response;
  atomicJSON(statePath, state);
  return { status: state.status, vendorStatus, kind: state.kind, jobId: state.jobId,
    errorCode: response.ErrorCode, errorMessage: response.ErrorMessage,
    requestId: response.RequestId, creditConsumed: response.ResultCreditConsumed };
}

export async function convert(requestPath, statePath, client = null) {
  const { body } = prepareRequest('convert', resolve(requestPath));
  assert(!existsSync(statePath), 'state file exists; inspect it instead of repeating conversion');
  client ??= makeClient();
  const state = stateStart('convert', conversion.action, body);
  atomicJSON(statePath, state);
  try {
    const response = await client.Convert3DFormat(body);
    assert(response?.ResultFile3D, 'Convert3DFormat returned no ResultFile3D; outcome may be uncertain');
    Object.assign(state, { status: 'DONE', requestId: response.RequestId, result: response });
    atomicJSON(statePath, state);
    return { status: 'DONE', requestId: response.RequestId, state: statePath };
  } catch (error) { throw failSubmission(state, statePath, error); }
}

function resultFiles(result) {
  const list = [];
  for (const file of result?.ResultFile3Ds ?? []) {
    if (file.Url) list.push({ url: file.Url, type: file.Type ?? '3D' });
    if (file.PreviewImageUrl) list.push({ url: file.PreviewImageUrl, type: 'preview' });
  }
  if (result?.ResultFile3D) list.push({ url: result.ResultFile3D, type: 'converted' });
  if (result?.PartSegmentationInfoUrl)
    list.push({ url: result.PartSegmentationInfoUrl, type: 'segmentation' });
  return [...new Map(list.map((file) => [file.url, file])).values()];
}

export function result(statePath) {
  const state = loadState(statePath);
  assert(state.status === 'DONE', 'query until DONE before reading result URLs');
  return { kind: state.kind, jobId: state.jobId ?? null, requestId: state.requestId,
    files: resultFiles(state.result), creditConsumed: state.result?.ResultCreditConsumed,
    partSegmentationInfo: state.result?.PartSegmentationInfo };
}

export async function download(statePath, outDir, downloader = downloadURL) {
  const state = loadState(statePath);
  assert(state.status === 'DONE', 'query until DONE before downloading');
  const files = resultFiles(state.result);
  assert(files.length > 0, 'DONE result has no downloadable URL; inspect the state file');
  mkdirSync(outDir, { recursive: true });
  assert(!existsSync(join(outDir, 'download_manifest.json')), 'download manifest exists; use a new directory');
  const saved = [];
  for (const [index, file] of files.entries()) {
    httpsUrl(file.url, 'result URL');
    const extension = extname(new URL(file.url).pathname).toLowerCase() ||
      (file.type === 'preview' ? '.png' : file.type === 'segmentation' ? '.json' : `.${file.type.toLowerCase()}`);
    assert(/^\.[a-z0-9]{1,6}$/.test(extension), 'unsupported result extension');
    const target = join(outDir, `vendor-${index}${extension}`);
    assert(!existsSync(target), `file exists: ${target}`);
    const hash = await downloader(file.url, target);
    saved.push({ type: file.type, path: basename(target), sha256: hash });
  }
  const manifest = { schema: 'tencent-cloud-ai3d-download.v2', kind: state.kind,
    jobId: state.jobId ?? null, files: saved };
  atomicJSON(join(outDir, 'download_manifest.json'), manifest);
  return manifest;
}
