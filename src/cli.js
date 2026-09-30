import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareRequest, assert } from './request.js';
import { submit, query, download, convert, result } from './cloud-sdk.js';
import { gltfCommand, normalizeAsset, reviewAsset, blenderBinary } from './assets.js';
import { resizeTextures } from './texture-resize.js';
import { generate, resume } from './workflow.js';
import { authLogin, authLogout, authStatus } from './credentials.js';
import { operations, conversion, resolveOperation } from './operations.js';

const HELP = `hunyuan3d — Tencent Cloud AI3D Node SDK and local GLB tools

  hunyuan3d auth login
  hunyuan3d auth status
  hunyuan3d auth logout
  hunyuan3d operations
  hunyuan3d validate <operation> <request.json>
  hunyuan3d generate <operation> <request.json> --out <directory> --confirm-spend
      [--asset-id <id> --version <number> --source-front <axis> --target-size <w> <d> <h>]
  hunyuan3d resume --out <directory>
  hunyuan3d submit <operation> <request.json> --state <job.json> --confirm-spend
  hunyuan3d status --state <job.json>
  hunyuan3d result --state <job.json>
  hunyuan3d download --state <job.json> --out <directory>
  hunyuan3d convert <request.json> --state <job.json> --confirm-spend
  hunyuan3d asset normalize --input <model.glb> --out <directory> --asset-id <id>
      --version <number> --source-front <+X|-X|+Y|-Y> --target-size <width> <depth> <height>
      [--attachment <floor|wall|ceiling|free>] [--anchor <bottom-center|center>]
      [--source-dir <directory>] [--source-job-id <id>] [--provider-model <model-id>]
      [--blender <executable>]
  hunyuan3d asset review <asset-directory> --approve --reviewer <name> --notes <text>
  hunyuan3d asset inspect --input <model.glb>
  hunyuan3d asset optimize --input <model.glb> --out <new.glb> [--profile <copy|web>]
  hunyuan3d asset resize-textures --input <model.glb> --out <new.glb>
      [--base-color <px>] [--normal <px>] [--metallic-roughness <px>]
      [--occlusion <px>] [--emissive <px>]
  hunyuan3d doctor`;

function parse(tokens, valueFlags, boolFlags = []) {
  const values = {};
  const positionals = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (boolFlags.includes(token)) { values[token] = true; continue; }
    if (Object.hasOwn(valueFlags, token)) {
      const count = valueFlags[token];
      const parts = tokens.slice(i + 1, i + count + 1);
      assert(parts.length === count && parts.every((part) => part && !part.startsWith('--')),
        `${token} requires ${count} value${count === 1 ? '' : 's'}`);
      values[token] = count === 1 ? parts[0] : parts;
      i += count;
      continue;
    }
    assert(!token.startsWith('--'), `unknown option: ${token}`);
    positionals.push(token);
  }
  return { values, positionals };
}

function required(values, key) {
  assert(values[key] !== undefined, `${key} is required`);
  return values[key];
}

function only(positionals, count) {
  assert(positionals.length === count, `expected ${count} positional argument${count === 1 ? '' : 's'}`);
}

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || ['help', '--help', '-h'].includes(command)) { console.log(HELP); return; }
  if (command === 'operations') {
    only(rest, 0);
    console.log(JSON.stringify({ jobs: Object.entries(operations).map(([name, op]) =>
      ({ name, submit: op.submit, query: op.query, guide: op.guide })),
      conversion: { action: conversion.action, guide: conversion.guide } }));
    return;
  }
  if (command === 'auth') {
    only(rest, 1);
    const action = rest[0];
    if (action === 'login') console.log(JSON.stringify(authLogin()));
    else if (action === 'status') console.log(JSON.stringify(authStatus()));
    else if (action === 'logout') console.log(JSON.stringify(authLogout()));
    else throw new Error(`unknown auth command: ${action}`);
    return;
  }
  if (command === 'validate') {
    only(rest, 2);
    const kind = rest[0] === 'convert' ? 'convert' : resolveOperation(rest[0]).name;
    const prepared = prepareRequest(kind, resolve(rest[1]));
    console.log(JSON.stringify({ valid: true, operation: kind, action: prepared.action,
      keys: Object.keys(prepared.body).sort() }));
    return;
  }
  if (command === 'generate') {
    const { values, positionals } = parse(rest, { '--out': 1,
      '--asset-id': 1, '--version': 1, '--source-front': 1, '--target-size': 3,
      '--attachment': 1, '--anchor': 1, '--blender': 1 }, ['--confirm-spend']);
    only(positionals, 2);
    assert(values['--confirm-spend'], 'generate requires --confirm-spend');
    const assetFlags = ['--version', '--source-front', '--target-size', '--attachment', '--anchor', '--blender'];
    assert(values['--asset-id'] !== undefined || assetFlags.every((flag) => values[flag] === undefined),
      '--asset-id is required for asset normalization options');
    let asset = null;
    if (values['--asset-id'] !== undefined) {
      asset = { assetId: values['--asset-id'], version: Number(required(values, '--version')),
        sourceFront: required(values, '--source-front'), targetSize: required(values, '--target-size').map(Number),
        attachment: values['--attachment'] ?? 'floor', anchor: values['--anchor'] ?? 'bottom-center',
        blender: values['--blender'] };
      assert(Number.isInteger(asset.version) && asset.version > 0, 'version must be positive integer');
      assert(['+X', '-X', '+Y', '-Y'].includes(asset.sourceFront), 'invalid source front');
      assert(asset.targetSize.every((n) => Number.isFinite(n) && n > 0),
        'target-size requires positive width, depth, height');
    }
    console.log(JSON.stringify(await generate(resolveOperation(positionals[0]).name,
      resolve(positionals[1]), resolve(required(values, '--out')), asset)));
    return;
  }
  if (command === 'resume') {
    const { values, positionals } = parse(rest, { '--out': 1 });
    only(positionals, 0);
    console.log(JSON.stringify(await resume(resolve(required(values, '--out')))));
    return;
  }
  if (command === 'submit') {
    const { values, positionals } = parse(rest, { '--state': 1 }, ['--confirm-spend']);
    only(positionals, 2);
    assert(values['--confirm-spend'], 'submit requires --confirm-spend');
    console.log(JSON.stringify(await submit(resolveOperation(positionals[0]).name,
      resolve(positionals[1]), resolve(required(values, '--state')))));
    return;
  }
  if (command === 'status') {
    const { values, positionals } = parse(rest, { '--state': 1 });
    only(positionals, 0);
    console.log(JSON.stringify(await query(resolve(required(values, '--state')))));
    return;
  }
  if (command === 'result') {
    const { values, positionals } = parse(rest, { '--state': 1 });
    only(positionals, 0);
    console.log(JSON.stringify(result(resolve(required(values, '--state')))));
    return;
  }
  if (command === 'download') {
    const { values, positionals } = parse(rest, { '--state': 1, '--out': 1 });
    only(positionals, 0);
    console.log(JSON.stringify(await download(resolve(required(values, '--state')),
      resolve(required(values, '--out')))));
    return;
  }
  if (command === 'convert') {
    const { values, positionals } = parse(rest, { '--state': 1 }, ['--confirm-spend']);
    only(positionals, 1);
    assert(values['--confirm-spend'], 'convert requires --confirm-spend');
    console.log(JSON.stringify(await convert(resolve(positionals[0]), resolve(required(values, '--state')))));
    return;
  }
  if (command === 'doctor') {
    only(rest, 0);
    const gltf = JSON.parse(readFileSync(fileURLToPath(new URL('../node_modules/@gltf-transform/cli/package.json', import.meta.url)), 'utf8'));
    const blender = blenderBinary();
    const blenderCheck = spawnSync(blender, ['--version'], { encoding: 'utf8', timeout: 10000 });
    console.log(JSON.stringify({ node: process.version, provider: 'Tencent Cloud AI3D Node SDK',
      gltfTransform: gltf.version, blender: blenderCheck.status === 0 ? blender : null,
      authentication: authStatus() }));
    return;
  }
  if (command !== 'asset') throw new Error(`unknown command: ${command}`);
  const [assetCommand, ...tail] = rest;
  if (assetCommand === 'normalize') {
    const { values, positionals } = parse(tail, {
      '--input': 1, '--out': 1, '--asset-id': 1, '--version': 1, '--source-front': 1,
      '--target-size': 3, '--attachment': 1, '--anchor': 1, '--source-dir': 1,
      '--source-job-id': 1, '--provider-model': 1, '--blender': 1,
    });
    only(positionals, 0);
    normalizeAsset({ input: resolve(required(values, '--input')), out: resolve(required(values, '--out')),
      assetId: required(values, '--asset-id'), version: Number(required(values, '--version')),
      sourceFront: required(values, '--source-front'), targetSize: required(values, '--target-size').map(Number),
      attachment: values['--attachment'], anchor: values['--anchor'], sourceDir: values['--source-dir'],
      sourceJobId: values['--source-job-id'], providerModel: values['--provider-model'], blender: values['--blender'] });
    return;
  }
  if (assetCommand === 'review') {
    const { values, positionals } = parse(tail, { '--reviewer': 1, '--notes': 1 }, ['--approve']);
    only(positionals, 1);
    console.log(JSON.stringify(reviewAsset(positionals[0], required(values, '--reviewer'),
      required(values, '--notes'), values['--approve'])));
    return;
  }
  if (assetCommand === 'inspect') {
    const { values, positionals } = parse(tail, { '--input': 1 });
    only(positionals, 0);
    gltfCommand('inspect', required(values, '--input'));
    return;
  }
  if (assetCommand === 'optimize') {
    const { values, positionals } = parse(tail, { '--input': 1, '--out': 1, '--profile': 1 });
    only(positionals, 0);
    console.log(JSON.stringify(gltfCommand('optimize', required(values, '--input'),
      required(values, '--out'), values['--profile'] ?? 'copy')));
    return;
  }
  if (assetCommand === 'resize-textures') {
    const { values, positionals } = parse(tail, { '--input': 1, '--out': 1,
      '--base-color': 1, '--normal': 1, '--metallic-roughness': 1,
      '--occlusion': 1, '--emissive': 1 });
    only(positionals, 0);
    const sizes = Object.fromEntries([
      ['baseColor', '--base-color'], ['normal', '--normal'],
      ['metallicRoughness', '--metallic-roughness'], ['occlusion', '--occlusion'],
      ['emissive', '--emissive'],
    ].filter(([, flag]) => values[flag] !== undefined).map(([slot, flag]) => [slot, Number(values[flag])]));
    console.log(JSON.stringify(await resizeTextures({ input: required(values, '--input'),
      out: required(values, '--out'), sizes })));
    return;
  }
  throw new Error(`unknown asset command: ${assetCommand ?? ''}`);
}
