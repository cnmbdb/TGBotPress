# Database portability work

## Current implementation

The application is PostgreSQL-specific. `src/server/db.server.ts` exports a `pg.Pool`, and request handlers depend on `pg` query results and `PoolClient` transactions. Production startup imports `pg` directly in `scripts/migrate-production.mjs` and runs PostgreSQL-only SQL from both `legacy/000-legacy-schema.sql` and `migrations/*.sql`.

The current source contains roughly 3,500 numbered PostgreSQL placeholders and 1,500 occurrences of PostgreSQL-specific constructs such as `jsonb`, array operators, casts, `RETURNING`, advisory locks, partial indexes, bytea, and PostgreSQL date arithmetic. Driver substitution by changing `DB_HOST` or a URL cannot support another engine. A provider-neutral query/result contract now exists, and a MySQL connection adapter handles connection pooling, transactions and positional placeholder ordering. The adapter is not selected by the app yet, and the PostgreSQL schema/query dialect has not been migrated.

## Target architecture

- Keep the current PostgreSQL backend as the compatibility baseline.
- Add an explicit database provider setting and a small repository interface for query, transaction, row count, and shutdown. Do not expose provider-specific pool/client types in application modules.
- Keep schema and migration sets provider-specific. A migration runner must select exactly one provider's ordered migrations and record applied migration IDs transactionally where the engine supports transactions.
- Make ID generation, JSON storage, binary values, date arithmetic, locking, conflict handling, and affected-row semantics explicit in the provider layer or repository methods. Do not translate arbitrary SQL with global string substitutions.
- Require isolated-database integration coverage for login/session, permissions, configuration, plugins, orders, worker claims, and migrations for every supported provider.

## Provider boundaries

### MySQL / MariaDB

Runs in the existing Node and Docker application model. Requires a MySQL driver, provider-specific legacy schema and all platform migrations, plus review of PostgreSQL transaction/locking and type semantics.

### SQLite

Suitable for a single-host Node deployment using a durable local file and one coordinated writer. Requires a SQLite driver, a SQLite schema/migration set, and concurrency-aware worker behavior. A container-local file without a persistent volume is not durable.

### Cloudflare D1

D1 is accessed through a Cloudflare binding and SQLite semantics. It cannot be selected by pointing the current Node `pg.Pool` at a D1 URL. D1 support needs a Workers-compatible application entry point, binding-aware database adapter, D1 migrations, and compatible scheduling/queue/webhook execution. It is a separate runtime target sharing domain logic where practical.

## Delivery gates

Each provider is supported only after a clean database can initialize, migrations can be reapplied safely, authenticated routes and representative business transactions pass integration tests, and background workers are verified for concurrent claims and restart recovery. Deployment documentation must name the exact provider/runtime pair that passed those checks.
