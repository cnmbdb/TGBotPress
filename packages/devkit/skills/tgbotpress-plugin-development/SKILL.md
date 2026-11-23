---
name: tgbotpress-plugin-development
description: Develop and validate plugins for the TGBotPress platform using its SDK and host contracts.
---

# TGBotPress Plugin Development

Read the host's plugin guide and SDK declarations before coding. Generate a starter with `npx @tgbotpress/devkit plugin create --id example --name 'Example'`. The scaffold is only a package skeleton; it does not register routes, jobs, permissions, or Telegram handlers in the host.

Trace the relevant host integration points, implement business logic behind explicit interfaces, preserve authorization and lifecycle checks, then test from an isolated consumer project. Never put bot tokens, private keys, or other credentials in a plugin package. Marketplace listing, package publication, host integration, and runtime installation are separate steps.
