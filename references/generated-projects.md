# What the generator writes, and how to build, run and update it

## Every backend project

- Spring Boot, Maven, Java 21 (or 17). **No `mvnw`**: use `mvn` from the PATH.
- Dependencies come from Menora's Artifactory (`repo.menora.co.il`): the project's `settings.xml`
  reads `ARTIFACTORY_USER` / `ARTIFACTORY_PASSWORD` (`mvn -s settings.xml verify`). Off that network
  a build fails on resolution — say so; never point the pom at Maven Central instead.
- `menora-model.json` at the root: what the project was generated from. **Commit it.** It is the
  base of every later update (`mi.mjs update`).
- `server.port: ${PORT:8080}`; the Docker image listens on 3000 (`Dockerfile`, `k8s/values.yaml`,
  `k8s/Jenkinsfile`).
- Local Vault: off by default; a `VAULT_TOKEN` in the environment or in the git-ignored `.env` turns
  the `vault-local` profile on. Never commit `.env`.
- Logging: JSON lines via log4j2 (`logFormat.json`).
- `HELP.md`: per-dependency notes, and how to reopen and update the project.

### Running it

| The project has | Run |
|---|---|
| nothing that needs a service (H2) | `mvn spring-boot:run` |
| PostgreSQL, Oracle, SQL Server, MongoDB, Redis or Kafka | `compose.yaml` + the `compose` profile: `docker compose up -d`, then `mvn spring-boot:run -Dspring-boot.run.profiles=compose` (`docker compose down` throws the data away). DB2 (IBM i) has no image. Images pull through `repo.menora.co.il/dockerhub/`. |
| `ldap-auth` / `ldap-auth-rest` | add the `local` profile on a developer machine (`-Dspring-boot.run.profiles=local`, or `compose,local`): `dev-user` gets its roles without LDAP |
| `testcontainers` | `ContainerDatabaseTests` starts the databases in Docker during `mvn test` (skipped without Docker) |
| `flyway` | the schema is in `src/main/resources/db/migration`; Hibernate validates it |
| a fullstack project on PostgreSQL/Oracle/SQL Server | `docker compose up -d postgres` (or `oracle`, `mssql`), then `mvn spring-boot:run -Dspring-boot.run.profiles=compose,local` |

### Multi-module

Root `pom.xml` (parent) + `<artifactId>-api` (the `@SpringBootApplication`, web layer),
`-core`, `-persistence`. `mvn verify` at the root; run the api module.

## Fullstack project

```
<artifactId>/
  backend/     Spring Boot + JPA: entity, repository, service, controller, DTO per entity
  frontend/    React + Vite + TypeScript + Tailwind 4 (or Menora's design system)
  compose.yaml database (if any) + backend + frontend, all in Docker
  README.md    layout, how to run, who may do what, tests, events, uploads
  menora-model.json
  .gitignore   backend/target, backend/.env, frontend/node_modules, frontend/dist
```

- **API**: `/api/<entities-in-kebab-plural>` — list (search, sort, page, filters), get, create,
  update, delete; plus per option: bulk, CSV/XLSX export, CSV import, history, transitions, views.
- **Access** (with `ldap-auth-rest`, the default): every call needs a `userinfo` header and the
  entity's read/write level; no header → 401, wrong role → 403. Locally: run the backend with the
  `local` profile; the frontend's dev server sends `userinfo: dev-user`.
  With `access.owners` a user gets only their own rows (or sees all and changes their own);
  `dev-user` is an ADMIN in the `local` profile and so sees everything — set
  `app.security.dev-roles.dev-user: USER` there to see the limit at work.
- **Backend**: `cd backend && mvn verify` (the `tests` option gives each entity an `<Entity>ApiTest`
  through the real controller and an in-memory H2 on the `test` profile — passes with no database
  running). `mvn test -Pdb-tests` runs them on the real PostgreSQL/Oracle/SQL Server in Docker.
  Run: `mvn spring-boot:run -Dspring-boot.run.profiles=local` → :8080.
- **Frontend**: `cd frontend && npm install`, then `npm run dev` (:5173, `/api` proxied to :8080),
  `npm test` (Vitest, with the `tests` option), `npm run build` (`tsc -b && vite build`),
  `npm run lint`, `npm run typecheck`. npm packages come from Menora's npm mirror.
- **Everything in Docker**: `docker compose up --build`, then http://localhost:3000 (nginx serves
  the app and proxies `/api/` to the backend). Needs the Menora network for the images.
- **Seed data** (`seedData` option): `DemoDataLoader` fills an empty database on start.
- **Uploads** (FILE/IMAGE fields): `app.attachments.storage` = `database` (default), `filesystem`
  (`app.attachments.directory`) or `s3` (`app.attachments.s3.*`; MinIO/Ceph/AWS, signed by hand, not
  yet run against a real store). Unattached uploads go after `app.attachments.keep-unattached` (24h).
- **Events** (`events` option): an outbox relayed to Kafka (with the `kafka` dependency), webhooks
  (`app.events.webhooks`) and `GET /api/events/stream` (SSE).
- **E-mails** (a workflow transition's `notify`, with or without `events`): off until
  `app.events.mail.enabled: true` and `spring.mail.host` are set — tell the user.

## An update zip (`mi.mjs update`)

`UPDATE.md` (read it), `update.patch` (git format), `DELETED.txt` (only when files go), `files/`
(each new or changed file whole). Each fetch stamps a new migration timestamp: apply the update
that was reviewed (`mi update <dir> --use <update-dir> --apply`), not a fresh one.

The rules that keep a team's own code safe:

1. The project must be committed **as generated** before anyone edits it — the three-way merge
   needs those blobs. `mi.mjs generate` reminds of this in its `next` steps.
2. Apply from a clean working tree: `mi.mjs update <dir> --use <update-dir> --apply` (or
   `git apply --3way --whitespace=nowarn update.patch` by hand from the project root). The applied
   files are staged: review with `git diff HEAD`, not `git diff`.
3. Conflicts are left as `<<<<<<< ours` / `>>>>>>> theirs` markers and listed; resolve each keeping
   the team's intent, then build and test.
4. Files git does not track (a git-ignored `.env`), and files the new model no longer generates
   but the patch did not remove (`HELP.md`), are reported under `leftAlone` — ask before deleting.
5. A fullstack migration (`V<timestamp>__model_update.sql`): check the live part, and the
   commented-out "To review" part (drops, NOT NULL, type changes) with the user — those touch data.
6. Never regenerate a project over itself to change it; that throws away everything the team wrote.
