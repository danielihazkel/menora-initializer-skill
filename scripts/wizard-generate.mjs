#!/usr/bin/env node
// POST /starter-wizard.zip — JSON-body sibling of /starter.zip that also
// accepts SQL DDL, OpenAPI specs, and WSDLs to drive the wizards.
//
// Usage:
//   node wizard-generate.mjs --file payload.json --out ./out/app.zip
//   cat payload.json | node wizard-generate.mjs
//
// Body: same as wizard-preview.mjs (WizardStarterRequest).
//
// Output: { savedTo, sizeBytes }

import { createWriteStream } from 'node:fs';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs, fullUrl, readStdin, fail } from './_lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const raw = flags.file && flags.file !== true
  ? await readFile(String(flags.file), 'utf8')
  : await readStdin();

if (!raw.trim()) {
  await fail('No JSON body provided. Pass --file <path> or pipe JSON to stdin.');
}

let body;
try {
  body = JSON.parse(raw);
} catch (e) {
  await fail('Invalid JSON: ' + e.message);
}

const out = flags.out && flags.out !== true
  ? String(flags.out)
  : `./${body.artifactId || 'demo'}.zip`;

await mkdir(dirname(out), { recursive: true });

const url = fullUrl('/starter-wizard.zip');
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

if (!res.ok) {
  const errBody = await res.text().catch(() => '');
  await fail(`HTTP ${res.status} ${res.statusText} ${url}\n${errBody}`);
}

await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
const s = await stat(out);
process.stdout.write(JSON.stringify({ savedTo: out, sizeBytes: s.size }, null, 2) + '\n');
