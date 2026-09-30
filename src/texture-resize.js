import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { listTextureSlots } from '@gltf-transform/functions';
import sharp from 'sharp';
import { assert } from './request.js';

const GLTF_CLI = fileURLToPath(new URL('../node_modules/@gltf-transform/cli/bin/cli.js', import.meta.url));
const SLOT_FLAGS = Object.freeze({
  baseColorTexture: 'baseColor',
  normalTexture: 'normal',
  metallicRoughnessTexture: 'metallicRoughness',
  occlusionTexture: 'occlusion',
  emissiveTexture: 'emissive',
});

export async function resizeTextures(options) {
  const input = resolve(options.input), output = resolve(options.out);
  assert(existsSync(input) && extname(input).toLowerCase() === '.glb', 'input must be an existing GLB');
  assert(extname(output).toLowerCase() === '.glb' && output !== input && !existsSync(output),
    'output must be a new .glb path different from input');
  const requested = Object.entries(options.sizes).filter(([, value]) => value !== undefined);
  assert(requested.length > 0, 'set at least one texture size');
  for (const [slot, size] of requested) assert(Number.isInteger(size) && size >= 128 && size <= 8192,
    `${slot} size must be an integer from 128 to 8192`);

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(input);
  const changes = [];
  for (const texture of document.getRoot().listTextures()) {
    const slots = listTextureSlots(texture);
    const selected = slots.map((slot) => options.sizes[SLOT_FLAGS[slot]]).filter((size) => size !== undefined);
    if (!selected.length) continue;
    assert(selected.length === slots.length,
      `texture ${texture.getName() || '(unnamed)'} is shared with an unconfigured slot; specify its size too`);
    assert(['image/png', 'image/jpeg'].includes(texture.getMimeType()),
      `texture ${texture.getName() || '(unnamed)'} must be PNG or JPEG for resize`);
    const original = texture.getImage();
    assert(original, `texture ${texture.getName() || '(unnamed)'} has no embedded image`);
    const before = await sharp(original).metadata();
    const limit = Math.max(...selected);
    if (before.width <= limit && before.height <= limit) continue;
    const format = texture.getMimeType() === 'image/png' ? 'png' : 'jpeg';
    const resized = await sharp(original).resize({ width: limit, height: limit,
      fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
      .toFormat(format).toBuffer();
    const after = await sharp(resized).metadata();
    texture.setImage(resized);
    changes.push({ texture: texture.getName(), slots, before: [before.width, before.height],
      after: [after.width, after.height] });
  }
  assert(changes.length > 0, 'no selected textures exceeded their size limits');

  mkdirSync(dirname(output), { recursive: true });
  const staged = resolve(dirname(output), `.${basename(output)}.${randomUUID()}.glb`);
  try {
    await io.write(staged, document);
    const validation = spawnSync(process.execPath, [GLTF_CLI, 'validate', staged], { encoding: 'utf8' });
    assert(!validation.error && validation.status === 0,
      `glTF validation failed: ${(validation.stderr || validation.stdout || '').trim()}`);
    renameSync(staged, output);
  } finally { if (existsSync(staged)) rmSync(staged); }
  return { output, inputBytes: statSync(input).size, outputBytes: statSync(output).size,
    sha256: createHash('sha256').update(readFileSync(output)).digest('hex'), changes };
}
