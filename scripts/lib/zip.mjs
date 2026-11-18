// Reading the generator's zips without a dependency: the central directory, then each entry
// stored or deflated (the only two methods a Java ZipOutputStream writes).

import { inflateRawSync } from 'node:zlib';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Every entry of a zip held in memory: [{ path, dir, data() }]. */
export function readZip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { end = i; break; }
  }
  if (end < 0) throw new Error('not a zip (no end of central directory)');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const mode = buf.readUInt16LE(p + 4) >> 8 === 3 ? buf.readUInt32LE(p + 38) >>> 16 : 0;
    const local = buf.readUInt32LE(p + 42);
    const path = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    entries.push({
      path,
      dir: path.endsWith('/'),
      executable: (mode & 0o111) !== 0,
      data() {
        if (buf.readUInt32LE(local) !== LOCAL) throw new Error(`corrupt zip entry ${path}`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + compressed);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) return inflateRawSync(raw);
        throw new Error(`zip entry ${path} uses compression method ${method}`);
      },
    });
  }
  return entries;
}

/** The single folder every entry sits in (the project's root in the zip), or '' when there is none. */
export function commonRoot(entries) {
  const firsts = new Set(entries.map((e) => e.path.split('/')[0]));
  if (firsts.size !== 1) return '';
  const [root] = firsts;
  return entries.every((e) => e.path.startsWith(root + '/')) ? root + '/' : '';
}

/**
 * Writes the entries under `target`. `strip` removes a leading folder (the zip's root) from each
 * path. A path that would land outside `target` is refused, never written.
 */
export async function extract(entries, target, { strip = '' } = {}) {
  const base = resolve(target);
  const written = [];
  for (const e of entries) {
    if (e.dir) continue;
    const rel = strip && e.path.startsWith(strip) ? e.path.slice(strip.length) : e.path;
    if (!rel) continue;
    const out = resolve(base, rel);
    if (out !== base && !out.startsWith(base + sep)) throw new Error(`zip entry escapes the target folder: ${e.path}`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, e.data());
    if (e.executable && process.platform !== 'win32') await chmod(out, 0o755);
    written.push(rel);
  }
  return written;
}
