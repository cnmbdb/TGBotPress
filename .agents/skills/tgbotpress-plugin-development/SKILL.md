---
name: tgbotpress-plugin-development
description: Develop and validate plugins for the TGBotPress platform using its SDK and host contracts.
---

# TGBotPress Plugin Development

Read the host's plugin guide and SDK declarations before coding. Generate a starter with `npx @tgbotpress/mcp plugin create --id example --name 'Example'`. The scaffold is only a package skeleton; it does not register routes, jobs, permissions, or Telegram handlers in the host.

Trace the relevant host integration points, implement business logic behind explicit interfaces, preserve authorization and lifecycle checks, then test from an isolated consumer project. Never put bot tokens, private keys, or other credentials in a plugin package. Marketplace listing, package publication, host integration, and runtime installation are separate steps.

For third-party plugins, consult `ThirdPartyPlugin` and `ThirdPartyPluginManifest` in `packages/plugin-sdk/src/index.d.ts` and `docs/plugin-development.md`. A public npm package must carry `tgbotpress.plugin.json`; `package.json.tgbotpressPlugin` mirrors it for pre-execution package identification. The manifest declares its compiled `entry` (normally `./dist/index.js`), and the exported plugin manifest must exactly match the sidecar. Declare schema/API/SDK/host/runtime compatibility, a unique lowercase or reverse-domain plugin ID, and only the permissions the plugin needs. Prefer fine-grained permissions such as `telegram.updates.read`, `telegram.messages.send`, `plugin.storage.read`, `plugin.storage.write`, `plugin.jobs.register`, and `admin.api`; scope plugin data by Bot ID. Export a plugin object with `manifest` and `activate(host)`; register relative HTTP routes, scheduled tasks, and Telegram handlers through the host. Registration is only valid while `activate` runs. Storage remains usable after activation. Telegram handlers should return `true` when they consume an update; `false` or `void` lets the next matching plugin inspect it. Use `validateThirdPartyPlugin` and `collectThirdPartyRegistrations` from the SDK to validate the contract during development.

The host dynamically dispatches authenticated HTTP routes through `/api/plugin-runtime?plugin=<id>&path=<route>`, schedules task registrations with lifecycle leases, dispatches declared Telegram update types with per-plugin delivery records, and provides Bot-scoped storage. Before install, the plugin manager shows the manifest, dependencies, and requested permissions; only an explicit superadmin confirmation starts installation. Admin pages and navigation still require static host integration. Plugin code executes with the host Node.js process privileges; permissions and `--ignore-scripts` are not a sandbox. Validate installation, restart reload, authorization, task/Telegram handling, drain and uninstall behavior before claiming compatibility.

The third-party install/runtime migrations currently target PostgreSQL only. MySQL, SQLite, and D1 do not expose the dynamic npm installer yet. Web and worker processes must share the installed package directory; multi-container deployments need a shared mount.
