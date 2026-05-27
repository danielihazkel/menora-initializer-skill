#!/usr/bin/env node
// Fetch one or all metadata sections from the Menora Initializr backend.
//
// Usage:
//   node metadata.mjs                          # --section all
//   node metadata.mjs --section client
//   node metadata.mjs --section extensions
//   node metadata.mjs --section sql-dialects
//
// Sections:
//   client | extensions | compatibility | starter-templates
//   sql-dialects | openapi-capable-deps | soap-capable-deps | all

import { parseArgs, readJson, fail } from './_lib.mjs';

const sections = {
  client: '/metadata/client',
  extensions: '/metadata/extensions',
  compatibility: '/metadata/compatibility',
  'starter-templates': '/metadata/starter-templates',
  'sql-dialects': '/metadata/sql-dialects',
  'openapi-capable-deps': '/metadata/openapi-capable-deps',
  'soap-capable-deps': '/metadata/soap-capable-deps',
};

const { flags } = parseArgs(process.argv.slice(2));
const section = flags.section || 'all';

if (section === 'all') {
  const keys = Object.keys(sections);
  const results = await Promise.all(keys.map((k) => readJson(sections[k])));
  const out = {};
  keys.forEach((k, i) => { out[k] = results[i]; });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else if (sections[section]) {
  const data = await readJson(sections[section]);
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
} else {
  await fail(`Unknown --section "${section}". Valid: ${Object.keys(sections).join(', ')}, all`);
}
