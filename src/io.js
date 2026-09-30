import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function atomicJSON(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}`);
  try {
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally { if (existsSync(temp)) rmSync(temp); }
}

export function readJSON(path) { return JSON.parse(readFileSync(path, 'utf8')); }

export async function downloadURL(url, path) {
  const source = new URL(url);
  if (source.protocol !== 'https:') throw new Error('result URL must use HTTPS');
  const response = await fetch(source, { redirect: 'follow', signal: AbortSignal.timeout(90000) });
  if (!response.ok || !response.body) throw new Error(`result download HTTP ${response.status}`);
  if (new URL(response.url).protocol !== 'https:') throw new Error('redirected result URL must use HTTPS');
  const temp = `${path}.${randomUUID()}.part`, hash = createHash('sha256');
  let size = 0;
  try {
    const meter = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > 500 * 1024 * 1024) callback(new Error('result exceeds 500 MiB'));
      else { hash.update(chunk); callback(null, chunk); }
    } });
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
    renameSync(temp, path);
    return hash.digest('hex');
  } finally { if (existsSync(temp)) rmSync(temp); }
}
