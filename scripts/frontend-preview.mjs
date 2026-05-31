#!/usr/bin/env node
// GET /frontend/starter.preview — returns a JSON tree + file list for a
// React/TS/Vite/FSD frontend project.
//
// Usage:
//   node frontend-preview.mjs --projectName demo --deps router,state-zustand \
//                             --reactVersion 18 --colorPalette ocean
//
// Flags (all optional; backend supplies defaults):
//   --projectName demo                    (default: demo)
//   --description / --scope / --appTitle
//   --reactVersion / --nodeVersion / --packageManager
//   --basePath /                          (default: /)
//   --deps router,state-zustand           (csv)
//   --colorPalette ocean
//   --apiBaseUrl http://localhost:8080
//   --backendArtifactId app
//   --opts design-mui=icons;router=guards (per-dep sub-options)
//
// Discover valid deps / versions / palettes with:
//   node metadata.mjs --section frontend
//
// Output: { files: [{path, content}], tree: [...] }

import { parseArgs, buildFrontendUrl, readJson } from './_lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const url = buildFrontendUrl('/frontend/starter.preview', flags);
const data = await readJson(url);
process.stdout.write(JSON.stringify(data, null, 2) + '\n');
