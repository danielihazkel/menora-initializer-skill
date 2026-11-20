---
name: menora-initializr
description: Generate and update projects with the Menora Initializr, Menora's on-prem project generator — Spring Boot services (plain or multi-module), code from a SQL schema, a live database, an OpenAPI spec, a WSDL or an AsyncAPI document, React frontends, and full CRUD apps (Spring backend + React frontend) from an entity model with workflows, access rules, dashboards and generated tests. Also updates a project that was generated before, merging the change with the team's edits. Use when the user wants a new Spring Boot / React / fullstack project "the Menora way", mentions the initializr, starter.zip, menora-model.json, a wizard (SQL/OpenAPI/SOAP/AsyncAPI/Kafka events), a fullstack example (Approvals, Orders, Tickets…), or wants to add entities, fields, dependencies or modules to a project that has a menora-model.json.
---

# Menora Initializr

One script does everything: `scripts/mi.mjs` next to this file (Node ≥ 18, no install). Below,
`mi` means `node <this skill's folder>/scripts/mi.mjs`. Every command prints JSON; `mi help` lists them.

## Before the first call

1. `mi health` → `{"status":"UP"}`. If it cannot reach the server (exit 3), ask the user for the
   URL (`MENORA_INITIALIZR_URL`, default `http://localhost:8080`) or to start it. Do not build or
   start the generator yourself.
2. If a call says `USERINFO_REQUIRED`, ask the user for their login and set `MENORA_USERINFO`
   (when the user has already said who they are, set it anyway: the audit then names them).
3. `mi meta` once: the Boot/Java versions, every dependency id (with its sub-options), the wizards,
   modules, template sets and fullstack examples **this** server offers. Never guess an id —
   `mi meta deps <text>` searches (JPA is `data-jpa`; LDAP is `ldap-auth-rest`).

## Pick the kind

| The user wants | Kind | Start from |
|---|---|---|
| a Spring Boot service | `backend` | flags: `--deps web,data-jpa,postgresql` |
| several Maven modules (api/core/persistence) | `multimodule` | `--modules api,core,persistence` |
| JPA entities from DDL or from a live database | `wizard` (SQL) | `sqlByDep` — `mi live ddl` writes the script |
| controllers and/or a client from an OpenAPI spec | `wizard` (OpenAPI) | `specByDep`, `apiStyle: "interfaces"` |
| SOAP endpoints/client from a WSDL | `wizard` (SOAP) | `wsdlByDep`; from disk: `--wsdl main.wsdl`, plus `--wsdl-files a.xsd,b.wsdl` (or a folder) when it imports other files |
| Kafka producers/listeners from AsyncAPI | `wizard` (events) | `asyncApiByDep` on `kafka` |
| a working CRUD app, backend + frontend | `fullstack` | `mi example <id>`, `mi import ddl`, or `mi live import` |
| a React app only | `frontend` | `mi generate frontend --projectName x --deps router` |
| to change a project generated before | update | `mi update <dir>` — never regenerate over it |

The kind is read from the request (entities → fullstack; a `*ByDep` document → wizard; `modules`
→ multimodule), so `mi preview|generate --file req.json` needs no kind except `frontend`.
A wizard request is always **one** module — the server drops `modules`; `mi` refuses the mix.

## The loop

1. **Write the request** as a JSON file (any of: a request, a project's `menora-model.json`, an
   example, a team preset/model) and/or flags: `--group --artifact --name --package --boot --java
   --packaging --deps a,b --add-deps a,b --db postgresql --opts "kafka=consumer-example;web=rest-example"
   --scaffold audit,tests --add-scaffold tests --modules a,b --department`. Flags override the
   file: `--deps` and `--scaffold` replace a list, `--add-deps` and `--add-scaffold` add to it, and
   `--db` puts one database in place of whichever the list had.
2. **Preview** before writing anything: `mi preview --file req.json` (file list; `--filter kafka`
   narrows it), then `--show pom.xml,application.yaml,OrderService.java` to read the files that
   matter. `mi` refuses unknown dependency ids, versions and modules before calling (exit 2, with
   suggestions); the server's refusal comes back with the place in the request (`path`).
3. **Generate** into the folder the user wants: `mi generate --file req.json --into ./orders`
   (refuses a non-empty folder without `--force`; `--zip f.zip` saves the archive instead). The
   answer lists `next` steps for that project.
4. **Verify**: `git init && git add -A && git commit -m "Generated"` right away — updates merge
   against that commit. Then build and run the generated tests (`next` says how). Builds resolve
   from Menora's Artifactory; if that is unreachable here, report it rather than changing the pom.
5. **Report** to the user what was generated, where, which options/dependencies were chosen and why,
   and what was verified (and what could not be).

Ask the user only about what changes the result and has no sensible default — the artifact name,
the database, which entities. Do not ask about what the generator defaults well (versions, packages).

## Recipes

**Service with a database, local run and container tests**
```
mi generate --artifact billing --deps web,data-jpa,postgresql,flyway,validation,actuator,testcontainers --into billing
```
`compose.yaml` + a `compose` profile come with any database/Kafka/Redis/Mongo dependency.

**Wizard** (one file, any mix of the four document maps; option details in `references/api.md`):
```json
{ "artifactId": "pets", "dependencies": ["web", "postgresql", "flyway"],
  "sqlByDep": { "postgresql": "CREATE TABLE owner (id BIGSERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL);" },
  "sqlOptions": { "postgresql": { "apiMode": "INLINE_DTO", "generateTests": true } },
  "specByDep": { "web": "<the OpenAPI document as one string>" },
  "openApiOptions": { "web": { "mode": "CONTROLLERS", "apiStyle": "interfaces", "copySpec": true } } }
```
Load documents from files into the JSON with a short `node -e` — do not retype them. Check a
document first: `mi detect paths|channels|services --file doc`.
Prefer `apiStyle: "interfaces"` for OpenAPI: the team's code lives in a class the next update
never touches.

**From a live database**: `mi live options` lists the admin's sources. With a source:
`mi live tables --source crm --schema sales`, then `mi live ddl --source crm --schema sales
--tables customer,orders --out schema.sql` (for `sqlByDep`) or `mi live import … --entities-only`
(for a fullstack `entities`). A typed connection is a JSON file without the password; the user sets
`MENORA_DB_PASSWORD`. Never write a password into a file, a command line or the chat.

**Fullstack app**
1. Start from the closest example (`mi examples`; `mi example approvals --artifact claims --out req.json`)
   or from a schema (`mi import ddl --file schema.sql --dialect POSTGRESQL --entities-only`).
2. Shape the model in `req.json`: entities, fields, relations, workflow, access, rules, pages.
   **Read `references/fullstack-model.md` before editing** — every property, with its rules. The
   vocabulary (types, page types, widget kinds, icons, limits) is live: `mi meta fullstack-schema`.
3. Good defaults: `opts.scaffold` with `tests` (real API tests + Vitest) and `audit`. Leave
   `dependencies` out — the set's defaults (`data-jpa, web, h2, validation, actuator,
   ldap-auth-rest`) are what access rules and workflow roles need — and change them with flags:
   on a real database `--db postgresql --add-deps flyway` (**`--db`, not `--add-deps postgresql`**:
   beside `h2` PostgreSQL would only be a second datasource).
4. `mi preview --file req.json` until the server accepts it; `--show application.yaml` to confirm
   the datasource. Then generate and build both halves.
5. The model's tables without a project: `mi tables ddl --file req.json --dialect ORACLE --out
   schema.sql` (the project's `V1__init.sql`, for any database). To create them on a database, only
   through an admin source with `createTables` (`mi live options`): `mi tables create --file req.json
   --source sandbox --schema APP --check` first, show the user the SQL, then the same without
   `--check` once they agree — it writes to their database.
5. Tell the user what the model cannot say (access is per role, not per row — "only my own"
   needs code), and what needs setting up (workflow e-mails are off until mail is configured).

**Update an existing project** (anything with a `menora-model.json`):
1. `mi model ./app` shows what it was generated from; `mi model ./app --out target.json` writes the
   request to edit (add a field, an entity, a page, a dependency…). Small changes can be flags:
   `mi update ./app --add-deps kafka --opts "kafka=consumer-example"`.
2. `mi update ./app --target target.json --out ./app-update` → the update, unpacked, and what it
   holds (counts, files, migration) without touching the project. Read `UPDATE.md` there, and the
   migration of a fullstack update.
3. `mi update ./app --use ./app-update --apply` applies exactly that update (asking again would
   stamp a new migration name). It needs the project in git with a clean tree; runs
   `git apply --3way` (which stages the result: review with `git diff HEAD`), copies
   `menora-model.json`, and reports `conflicts` and `leftAlone`.
4. Resolve conflicts keeping the team's code; ask before deleting anything in `leftAlone`; go over a
   fullstack `__model_update.sql` with the user (its commented-out part drops or tightens data).
   Build, test, and leave the commit to the user unless asked.

**Team presets and models** (`mi presets …`, `mi models …`): `list` and `get <id> --out req.json`
open what colleagues saved — a ready request. `save` and `delete` change what everyone sees: only
when the user asks, and confirm a delete first.

## Failures

| Exit | Meaning | Do |
|---|---|---|
| 1 | the server refused (4xx); stderr has its body and often `hint` / `path` | fix that place in the request |
| 2 | bad usage, or `mi`'s own check (unknown id, version, module) | follow the message |
| 3 | server unreachable | ask the user; do not start it |
| 4 | server error (5xx) | report it with the body; try `mi preview` to see the reason |

## References

- `references/fullstack-model.md` — the fullstack request: project, scaffold options, entity, field,
  relation, workflow, pages and widgets, expressions, names the generator reserves.
- `references/api.md` — every endpoint: wizard options, multi-module, update zips, live schema,
  team presets/models, frontend, headers, error bodies, limits.
- `references/generated-projects.md` — what each project contains, how to build, run and test it,
  profiles, compose, and the rules for applying an update.
- `tests/` — the script's own tests (`node --test tests/*.test.mjs`; the server must be up).
