# menora-initializr — tests

The skill's tests: `scripts/mi.mjs` run as an agent runs it (a child process; stdout, stderr and the
exit code checked), plus unit tests of its libraries. Node ≥ 18, nothing to install.

```
node --test tests/lib.test.mjs          # no server needed
node --test tests/*.test.mjs            # everything; the generator must be UP
MENORA_TEST_WRITE=1 node --test tests/*.test.mjs   # also team presets/models (writes shared rows, deletes them after)
```

Start the generator on a **scratch database** for these (the update tests generate many projects,
and the write tests save and delete team rows):

```powershell
cd backend
Copy-Item data\initializr.mv.db $env:TEMP\mi-test.mv.db
java -jar target\offline-spring-init-1.0.0-SNAPSHOT.jar "--spring.datasource.url=jdbc:h2:file:$env:TEMP\mi-test"
```

`MENORA_INITIALIZR_URL` points the tests at another server.

| File | What it holds |
|---|---|
| `lib.test.mjs` | every model shape `readModel` reads (backend model, fullstack request model, web editor snapshot, team preset, example, bare request); preset and team-model conversions both ways; flags and query strings; the zip reader (stored, deflated, executable bits, root folder) and its refusal of an entry outside the target |
| `cli.test.mjs` | `health`, `meta` (summary, deps search, raw sections), exit 3 when unreachable; `preview` (list, filter, show) and the checks before calling (unknown id/version/module → exit 2 with a suggestion); server refusals with `path`; `generate` for backend, `--zip`, multi-module, frontend, fullstack from an example (with `--add-deps` keeping the set's defaults); the SKILL.md wizard recipe (SQL + OpenAPI), SOAP, a WSDL in several files read from disk (`--wsdl` / `--wsdl-files`), events, detect, a broken spec; DDL import; live-schema refusals; team presets/models round trip (`MENORA_TEST_WRITE=1`) |
| `update.test.mjs` | `update` without `--apply` changes nothing; same model and dirty tree refused; `--apply` merges with a team edit; a conflict is marked and listed; a project in a sub-folder of a bigger repository (`--directory`), with its untracked `.env` left alone; a fullstack field arriving as code and a migration |
| `helpers.mjs` | `mi`, `miJson`, `miError`, `tempDir`, `git`, `requireBackend` |
| `fixtures/` | `openapi.yaml` (2 paths), `service.wsdl` (1 service), `split/` (a WSDL whose schema is in `schemas/greeting.xsd`), `asyncapi.yaml` (AsyncAPI 3, the backend's own fixture), `schema.sql` |

Everything is written under the OS temp folder (`mi-test-*`).
