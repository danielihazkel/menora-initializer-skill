# menora-initializr — automated tests

Black-box suite for the skill scripts under `../scripts/`. Each test spawns the real `node scripts/*.mjs` CLI and asserts on its stdout / stderr / exit code — same path Claude takes when invoking the skill. `run.test.mjs` is the happy-path smoke suite; the themed `*.test.mjs` files add deep error/edge coverage and structural checks on generated artifacts.

## Prereqs

- Node ≥ 18 (built-in `fetch` + `node:test`). No `npm install` needed.
- Backend running at `http://localhost:8080` (override with `MENORA_INITIALIZR_URL`).

## Run

```powershell
# 1. start the backend in one shell
cd C:\Users\DANIEL\projects\offline-spring-init\backend
java -jar target\offline-spring-init-1.0.0-SNAPSHOT.jar

# 2. run the suite in another
cd C:\Users\DANIEL\projects\offline-spring-init\.claude\skills\menora-initializr
node --test tests/*.test.mjs          # every test file
node --test tests/frontend.test.mjs   # just one file
```

Exit 0 on full pass; non-zero on any failure. If the backend isn't UP, each file's `before` hook fails fast with a clear message — no per-test noise. (The one exception: `url-override.test.mjs`'s unreachable-URL case needs no backend and always runs.)

## Layout

```
tests/
├── README.md              this file
├── run.test.mjs           happy-path smoke suite (every script)
├── fullstack.test.mjs     validation matrix, import-ddl, fullstack artifact structure
├── frontend.test.mjs      React-version filter, REQUIRES/CONFLICTS, sub-options, artifact structure
├── artifacts.test.mjs     backend/wizard pom + entry-point + zip entry-count checks
├── url-override.test.mjs  MENORA_INITIALIZR_URL honored / unreachable-URL fails loudly
├── helpers.mjs            runScript / runJson / runJsonError / assertFiles / findFile /
│                          parseJsonFile / assertZipEntries / pickVersionId
└── fixtures/
    ├── openapi.yaml        2 paths, used by detect + OpenAPI wizard tests
    ├── service.wsdl        1 service / 1 op, used by detect + SOAP wizard tests
    ├── schema.sql          1 CREATE TABLE, used by the import-ddl tests
    ├── fullstack.json      1-entity payload, used by run.test.mjs
    └── fullstack-rich.json 2 entities (ENUM/date/decimal/bool), used by structural checks
```

Wizard + fullstack payloads are stitched in-memory from `wizardBase()` / `fullstackBase()` + the fixtures.

## Coverage

| group | what it asserts |
|---|---|
| metadata | all 7 backend sections + `--section all`; `dependencies.values[].values[]` shape |
| plain generation — preview | web+data-jpa returns ≥15 files incl. `pom.xml`; h2 in `application.yaml`; missing `--type` surfaces 500 |
| plain generation — generate | zip written, magic bytes `PK\x03\x04` |
| sub-options round-trip | `kafka=consumer-example,producer-example` produces both example classes |
| SQL wizard | `Users.java` + `UsersRepository.java`; zip valid |
| OpenAPI wizard | CONTROLLERS / CLIENT / BOTH preview asserts presence AND absence of the wrong-side files; all 3 modes generate valid zips |
| SOAP wizard | same matrix |
| detect | `--type paths` and `--type services` return expected arrays |
| error paths | bad SQL / bad OpenAPI / bad WSDL → structured 400; OpenAPI / SOAP mode typo `"CLIENTS"` → 400 with "Valid values: …" |
| frontend & fullstack metadata | `--section frontend` (version dropdowns + catalog), `--section entity-template-sets`; `--section compatibility --projectKind FRONTEND` returns only FE rows with `relationType ∈ {REQUIRES,CONFLICTS,RECOMMENDS}` |
| frontend generation | preview returns a React project with `package.json`; generate writes a valid zip |
| fullstack | `import-ddl` turns `schema.sql` into a 1-entity array with a PK field; preview spans `backend/` + `frontend/` + root `README.md`; generate writes a valid zip; missing `entities` → 400 |

Deep coverage (the themed files):

| file · group | what it asserts |
|---|---|
| fullstack · validation matrix | 11 negatives → 400 `Invalid request`: no entities, no fields, 0/2+ primary keys, unknown type, ENUM ±`enumValues`, `length` on non-STRING, reserved-keyword name, duplicate entity/field names |
| fullstack · import-ddl | `POSTGRESQL` dialect parses; bad SQL → 400 `Invalid SQL` |
| fullstack · artifact structure | `fullstack-rich.json` preview: `backend/pom.xml` parses with substituted artifactId, `frontend/package.json` is valid JSON with a dev script, `Product.java` defines the class, root `README.md` present; generate zip ≥ 15 entries |
| frontend · React-version filter | `design-mui` offered for React 18, filtered out for React 19 (skips if a major is unseeded) |
| frontend · compatibility | REQUIRES: `design-shadcn` auto-adds Tailwind (`tailwind.config.js` + `components.json`); CONFLICTS: `design-shadcn,design-mui` drops `@mui/material` from `package.json` |
| frontend · sub-options | `comp-button,comp-card` gate `src/shared/ui/button.tsx` + `card.tsx`; absent without the opts |
| frontend · artifact structure | `package.json` valid JSON (dev script + deps), `tsconfig.json` + `vite.config.*` present; generate zip ≥ 5 entries |
| artifacts · backend/wizard | `preview` pom has `<project>` + Artifactory repo + substituted artifactId, an `@SpringBootApplication` class, `application.yaml`; generate + wizard-generate zips ≥ 10 entries |
| url-override | unreachable `MENORA_INITIALIZR_URL` → non-zero exit + network error in stderr (no backend needed); explicit reachable URL returns client metadata |

## When a test fails

The runner prints `node:test`'s standard reporter. For wizard tests, the failure message includes the actual `files[].path` list, so you can see what the script produced vs. what was expected. For error paths, the assertion fires on the body shape from `_lib.mjs:fail()`'s stderr output.

## When you add or rename a script

`helpers.mjs:SCRIPT(name)` resolves to `../scripts/${name}.mjs`. Rename a script and the matching test() will fail with a spawn ENOENT — that's the signal to update the test name.
