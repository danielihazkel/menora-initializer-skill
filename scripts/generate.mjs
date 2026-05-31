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

import { parseArgs, buildStarterUrl, saveZip } from './_lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const url = buildStarterUrl('/starter.zip', flags);

const out = flags.out && flags.out !== true
  ? String(flags.out)
  : `./${flags.artifactId || 'demo'}.zip`;

const res = await fetch(url);
const result = await saveZip(res, out);
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
