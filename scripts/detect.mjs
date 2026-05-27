#!/usr/bin/env node
// POST /starter-wizard.detect-paths or .detect-services — sanity-check that an
// OpenAPI spec / WSDL parses, and enumerate what's inside.
//
// Usage:
//   node detect.mjs --type paths    --file openapi.yaml
//   node detect.mjs --type services --file service.wsdl
//   cat openapi.yaml | node detect.mjs --type paths
//
// Output: string[]  (endpoint paths for "paths", service names for "services")

import { readFile } from 'node:fs/promises';
import { parseArgs, postJson, readStdin, fail } from './_lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const type = flags.type;
if (type !== 'paths' && type !== 'services') {
  await fail('--type must be "paths" or "services"');
}

const raw = flags.file && flags.file !== true
  ? await readFile(String(flags.file), 'utf8')
  : await readStdin();

if (!raw.trim()) {
  await fail('No content provided. Pass --file <path> or pipe content to stdin.');
}

const path = type === 'paths' ? '/starter-wizard.detect-paths' : '/starter-wizard.detect-services';
const body = type === 'paths' ? { spec: raw } : { wsdl: raw };
const data = await postJson(path, body);
process.stdout.write(JSON.stringify(data, null, 2) + '\n');
