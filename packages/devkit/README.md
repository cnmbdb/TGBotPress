# @tgbotpress/mcp

CLI, MCP server, and agent skill for developing plugins against the TGBotPress SDK and host contract.

## Install and scaffold

```sh
npm install --global @tgbotpress/mcp
tgbotpress plugin create --id hello-world --name "Hello World" --description "Example plugin"
cd tgbotpress-plugin-hello-world
npm install
npm pack --dry-run
```

The command creates an ESM package with a manifest, root export, and declaration stub. Scaffolding includes the SDK contract types locally, so the generated package can be installed without a separately published SDK. Edit the generated package name to your npm scope before publishing. The repository workflow publishes this package when a `mcp-v*` tag is pushed; it requires an `NPM_TOKEN` repository secret with publish access to `@tgbotpress`. Scaffolding does not register functionality in a host.

## MCP server

Run `tgbotpress mcp` as an stdio MCP server. Example client configuration:

```json
{
  "mcpServers": {
    "tgbotpress-mcp": {
      "command": "tgbotpress",
      "args": ["mcp"]
    }
  }
}
```

The `create_tgbotpress_plugin` tool writes a starter package into the requested directory. Review the path and generated files before using it.

## Agent skill

Install the bundled skill into the current directory with:

```sh
tgbotpress skill install
```

Pass `-d <directory>` to choose another skills folder.

The package contains `skills/tgbotpress-plugin-development/SKILL.md`. Copy it into the agent's skills directory or install it through the agent's supported skill mechanism. Always consult the target TGBotPress host's current plugin guide and SDK; capabilities and trust rules can vary by host version.

Third-party plugin execution and dynamic installation require host-side integration and security isolation. This package creates source files only and does not install or activate code in a running platform.
