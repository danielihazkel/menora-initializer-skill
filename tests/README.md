# menora-initializr — automated tests

Black-box smoke suite for the skill scripts under `../scripts/`. Each test spawns the real `node scripts/*.mjs` CLI and asserts on its stdout / stderr / exit code — same path Claude takes when invoking the skill.

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
node --test tests/run.test.mjs
```

Exit 0 on full pass; non-zero on any failure. If the backend isn't UP, the `before` hook fails fast with a clear message — no per-test failures.

## Layout

```
tests/
├── README.md          this file
├── run.test.mjs       all describe/it blocks
├── helpers.mjs        runScript / runJson / runJsonError / assertFiles
└── fixtures/
    ├── openapi.yaml   2 paths, used by detect + OpenAPI wizard tests
    └── service.wsdl   1 service / 1 op, used by detect + SOAP wizard tests
```

Wizard payloads are stitched in-memory from `wizardBase()` + the fixtures.

## Coverage

| group | what it asserts |
|---|---|
| metadata | all 7 sections + `--section all`; `dependencies.values[].values[]` shape |
| plain generation — preview | web+data-jpa returns ≥15 files incl. `pom.xml`; h2 in `application.yaml`; missing `--type` surfaces 500 |
| plain generation — generate | zip written, magic bytes `PK\x03\x04` |
| sub-options round-trip | `kafka=consumer-example,producer-example` produces both example classes |
| SQL wizard | `Users.java` + `UsersRepository.java`; zip valid |
| OpenAPI wizard | CONTROLLERS / CLIENT / BOTH preview asserts presence AND absence of the wrong-side files; all 3 modes generate valid zips |
| SOAP wizard | same matrix |
| detect | `--type paths` and `--type services` return expected arrays |
| error paths | bad SQL / bad OpenAPI / bad WSDL → structured 400; OpenAPI / SOAP mode typo `"CLIENTS"` → 400 with "Valid values: …" |

## When a test fails

The runner prints `node:test`'s standard reporter. For wizard tests, the failure message includes the actual `files[].path` list, so you can see what the script produced vs. what was expected. For error paths, the assertion fires on the body shape from `_lib.mjs:fail()`'s stderr output.

## When you add or rename a script

`helpers.mjs:SCRIPT(name)` resolves to `../scripts/${name}.mjs`. Rename a script and the matching test() will fail with a spawn ENOENT — that's the signal to update the test name.
