# TG Ultra platform migration

TanStack Start + React + TypeScript backend, PostgreSQL, TanStack Query/Table and registry-generated shadcn/ui components.

## Development

From this directory: `npm ci`, `npm run db:migrate`, `npm run dev`.
The Vite config reads the repository root `.env` server-side. Set `PLATFORM_ORIGIN` and `LEGACY_ORIGIN` to explicit, trusted origins. `PLATFORM_DB_HOST` can override `DB_HOST` when running on the Docker host. Never prefix credentials with `VITE_`.
Set `PLATFORM_URL` in the legacy Admin environment to exactly the same origin as `PLATFORM_ORIGIN`.

New database tables are additive; no legacy table is recreated. The migration uses a transaction and can be rerun.

## First migrated slice

- Native TypeScript PostgreSQL queries and authorization for bot listing, filtering and pagination.
- Native transactional bot-note updates and an audit entry; no Telegram API side effects.
- Opaque, hashed native sessions tied to the existing device-session expiry/revocation.
- Temporary, 60-second, one-use PKCE-style handoff from the authenticated PHP app. Existing verification and license gates run before issuance. Password/Passkey/MFA remain on the legacy login until separately ported.
- Bot tokens/passwords are excluded from API projections.

This is a development migration entry point, not a production replacement yet. Creation/deletion/webhooks, financial workflows and job workers still run in the legacy services. See `../docs/migrations/tanstack.md` for the inventory and next phases.

## Validation

`npm run typecheck`, `npm test`, `npm run build`. Validate `/api/health`; unauthenticated `/api/bots` must return 401 and cross-origin writes must return 403. Complete authentication in a browser, then check a restricted account separately before production cutover.
