# @tgbotpress/devkit

CLI, MCP server, and agent skill for developing plugins against the TGBotPress SDK and host contract.

## Install and scaffold

```sh
npm install --global @tgbotpress/devkit
tgbotpress plugin create --id example.hello-world --name "Hello World" --description "Example plugin"
cd tgbotpress-plugin-example.hello-world
tgbotpress plugin validate
npm pack --dry-run
```

The command creates an ESM package with the runtime sidecar manifest, matching npm metadata, a runnable Bot update handler, and self-contained declarations. Edit the generated npm package name and publish the fixed version before installing it from the TGBotPress plugin manager. The repository workflow publishes this devkit when a `devkit-v*` tag is pushed; it requires an `NPM_TOKEN` repository secret with publish access to `@tgbotpress`.

## MCP server

Run `tgbotpress mcp` as an stdio MCP server. Example client configuration:

```json
{
  "mcpServers": {
    "tgbotpress-devkit": {
      "command": "tgbotpress",
      "args": ["mcp"]
    }
  }
}
```

The `create_tgbotpress_plugin` tool writes a runnable starter package with a matching `tgbotpress.plugin.json`, `package.json.tgbotpressPlugin` metadata, a compiled `dist/index.js` entry, and an example Bot-scoped Telegram handler. Review the requested permissions and generated source before publishing the package. Generated type declarations are self-contained, so runtime installation does not need the SDK package inside the plugin's private dependency directory.

Run `tgbotpress plugin validate` in the package directory before packing. It checks manifest mirrors, package identity, permissions, entry path, and that the entry stays inside the package directory without importing plugin code.

## Agent skill

Install the bundled skill into the current directory with:

```sh
tgbotpress skill install
```

Pass `-d <directory>` to choose another skills folder.

The package contains `skills/tgbotpress-plugin-development/SKILL.md`. Copy it into the agent's skills directory or install it through the agent's supported skill mechanism. Always consult the target TGBotPress host's current plugin guide and SDK; capabilities and trust rules can vary by host version.

The host can dynamically install and run packages that satisfy its manifest and entry contract. Plugins run in the host Node.js process and are not sandboxed; install only code whose publisher and permissions you trust. The devkit creates and validates packages but does not publish them or install them into a running host.
