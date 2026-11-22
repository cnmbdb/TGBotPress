# Cloudflare D1 migrations

Generated from the SQLite schema and migration set by `scripts/generate-d1-migrations.mjs`.

Apply these files with the Cloudflare D1 migration workflow for the target database. The initial file includes the legacy schema and default permission seed; it does not create an administrator password or store secrets.

SQLite manual ports still pending:
- 020-platform-telegram-ignored-updates.sql (status is included by SQLite 006)

This package is only the D1-compatible schema/migration layer. The application still needs a Workers entrypoint, D1 binding integration, and transaction-path refactoring before it can run on D1.
