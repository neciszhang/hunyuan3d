import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assert } from './request.js';
import { atomicJSON } from './io.js';

const GLTF_CLI = fileURLToPath(new URL('../node_modules/@gltf-transform/cli/bin/cli.js', import.meta.url));
const BLENDER_SCRIPT = fileURLToPath(new URL('../blender/normalize.py', import.meta.url));

function run(command, args, name) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  assert(!result.error && result.status === 0, `${name} failed with exit code ${result.status ?? 'unknown'}`);
}

export function blenderBinary(override) {
  const candidate = override || process.env.BLENDER_BIN;
  if (candidate) return candidate;
  if (process.platform === 'darwin' && existsSync('/Applications/Blender.app/Contents/MacOS/Blender'))
    return '/Applications/Blender.app/Contents/MacOS/Blender';
  return 'blender';
}

export function normalizeAsset(options) {
  const { input, out, assetId, version, sourceFront, targetSize } = options;
  assert(existsSync(input), `input missing: ${input}`);
  assert(extname(input).toLowerCase() === '.glb', 'Blender normalizer accepts GLB only');
  assert(Number.isInteger(version) && version > 0, 'version must be positive integer');
  assert(['+X', '-X', '+Y', '-Y'].includes(sourceFront), 'invalid source front');
  assert(targetSize.length === 3 && targetSize.every((n) => Number.isFinite(n) && n > 0),
    'target-size requires positive width, depth, height');
  const args = ['-b', '--python', BLENDER_SCRIPT, '--', '--input', resolve(input), '--out', resolve(out),
    '--asset-id', assetId, '--version', String(version), '--source-front', sourceFront,
    '--target-size', ...targetSize.map(String), '--attachment', options.attachment ?? 'floor',
    '--anchor', options.anchor ?? 'bottom-center'];
  for (const [flag, value] of [['--source-dir', options.sourceDir], ['--source-job-id', options.sourceJobId],
    ['--provider-model', options.providerModel]]) if (value !== undefined) args.push(flag, String(value));
  run(blenderBinary(options.blender), args, 'Blender normalization');
}

export function reviewAsset(root, reviewer, notes, approve) {
  assert(approve, '--approve is required after visual review');
  const manifestPath = join(resolve(root), 'asset.json');
  const data = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert(data.schema === 'hunyuan-asset.v1' && data.status === 'needs_review',
    'asset manifest is not awaiting review');
  const model = resolve(root, data.model);
  const rel = relative(resolve(root), model);
  assert(rel && !rel.startsWith('..') && !rel.startsWith('/') && existsSync(model), 'model missing or outside asset package');
  const digest = createHash('sha256').update(readFileSync(model)).digest('hex');
  assert(digest === data.sha256, 'model hash changed since normalization');
  for (const view of ['front', 'back', 'side', 'top']) {
    const preview = join(root, 'previews', `${view}.png`);
    assert(existsSync(preview) && statSync(preview).size > 0, `missing preview: ${view}`);
  }
  assert(typeof notes === 'string' && notes.trim(), 'review notes must describe inspected geometry and appearance');
  data.status = 'ready';
  data.review = { ...data.review, geometry: 'pass', appearance: 'pass', reviewer, notes,
    reviewedAt: new Date().toISOString() };
  atomicJSON(manifestPath, data);
  return { status: 'ready', assetId: data.assetId, version: data.version };
}

export function gltfCommand(kind, input, out, profile = 'copy') {
  const source = resolve(input);
  assert(existsSync(source) && ['.glb', '.gltf'].includes(extname(source).toLowerCase()),
    'input must be an existing GLB or glTF file');
  assert(existsSync(GLTF_CLI), 'bundled glTF-Transform dependency missing; reinstall hunyuan3d');
  if (kind === 'inspect') {
    run(process.execPath, [GLTF_CLI, 'inspect', source], 'glTF-Transform inspect');
    run(process.execPath, [GLTF_CLI, 'validate', source], 'glTF-Transform validate');
    return;
  }
  const target = resolve(out);
  assert(extname(target).toLowerCase() === '.glb', 'output must be a .glb file');
  assert(source !== target && !existsSync(target), 'use a new output path; source and existing files are preserved');
  assert(['copy', 'web'].includes(profile), 'profile must be copy or web');
  mkdirSync(dirname(target), { recursive: true });
  const staged = join(dirname(target), `.${basename(target)}.${randomUUID()}.glb`);
  try {
    run(process.execPath, [GLTF_CLI, profile === 'copy' ? 'copy' : 'optimize', source, staged],
      'glTF-Transform process');
    run(process.execPath, [GLTF_CLI, 'validate', staged], 'glTF-Transform validate');
    assert(existsSync(staged) && statSync(staged).size > 0, 'glTF-Transform produced no output');
    renameSync(staged, target);
  } finally { if (existsSync(staged)) rmSync(staged); }
  const version = spawnSync(process.execPath, [GLTF_CLI, '--version'], { encoding: 'utf8' });
  return { output: target, profile, gltfTransformVersion: version.status === 0 ? version.stdout.trim() : null,
    sha256: createHash('sha256').update(readFileSync(target)).digest('hex') };
}
