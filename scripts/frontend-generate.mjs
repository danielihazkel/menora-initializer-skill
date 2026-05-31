#!/usr/bin/env node
// GET /frontend/starter.zip — generates a React/TS/Vite/FSD project ZIP and
// saves it to disk.
//
// Usage:
//   node frontend-generate.mjs --projectName demo --deps router,state-zustand \
//                              --out ./out/demo.zip
//
// Same flags as frontend-preview.mjs, plus:
//   --out <path>   Destination ZIP path. Default: ./<projectName>.zip
//
// Output: { savedTo, sizeBytes }

import { parseArgs, buildFrontendUrl, saveZip } from './_lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const url = buildFrontendUrl('/frontend/starter.zip', flags);

const out = flags.out && flags.out !== true
  ? String(flags.out)
  : `./${flags.projectName || 'demo'}.zip`;

const res = await fetch(url);
const result = await saveZip(res, out);
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
