#!/usr/bin/env node
// POST /starter-fullstack.zip — generates a fullstack scaffold (Spring Boot
// backend + React frontend) and saves the ZIP to disk. The archive contains
// backend/, frontend/, and a root README.md.
//
// Usage:
//   node fullstack-generate.mjs --file payload.json --out ./out/app.zip
//   cat payload.json | node fullstack-generate.mjs
//
// Body: same as fullstack-preview.mjs (FullstackStarterRequest).
//
// Output: { savedTo, sizeBytes }

import { parseArgs, fullUrl, resolveBody, saveZip } from './_lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const body = await resolveBody(flags);

const out = flags.out && flags.out !== true
  ? String(flags.out)
  : `./${body.artifactId || 'demo'}.zip`;

const res = await fetch(fullUrl('/starter-fullstack.zip'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const result = await saveZip(res, out);
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
