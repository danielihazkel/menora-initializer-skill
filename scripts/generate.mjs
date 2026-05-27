#!/usr/bin/env node
// GET /starter.zip — generates a Spring Boot project ZIP and saves it to disk.
//
// Usage:
//   node generate.mjs --groupId com.demo --artifactId app --packageName com.demo.app \
//                     --deps web,jpa --out ./out/app.zip
//
// Same flags as preview.mjs, plus:
//   --out <path>   Destination ZIP path. Default: ./<artifactId>.zip
//
// Output: { savedTo, sizeBytes }

import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs, buildStarterUrl, fail } from './_lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const url = buildStarterUrl('/starter.zip', flags);

const out = flags.out && flags.out !== true
  ? String(flags.out)
  : `./${flags.artifactId || 'demo'}.zip`;

await mkdir(dirname(out), { recursive: true });

const res = await fetch(url);
if (!res.ok) {
  const body = await res.text().catch(() => '');
  await fail(`HTTP ${res.status} ${res.statusText} ${url}\n${body}`);
}

await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
const s = await stat(out);
process.stdout.write(JSON.stringify({ savedTo: out, sizeBytes: s.size }, null, 2) + '\n');
