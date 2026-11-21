# @tgbotpress/plugin-sdk

Shared types for TGBotPress plugins. The SDK defines the manifest and lifecycle contract used when built-in modules are migrated into independent npm packages.

The SDK does not grant database, Telegram, filesystem or process access. A host must explicitly provide those capabilities and enforce permissions, lifecycle locks, migrations, logging and resource limits.
