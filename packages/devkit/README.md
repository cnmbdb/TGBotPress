# @tgbotpress/devkit

CLI, MCP server, and agent skill for developing plugins against the TGBotPress SDK and host contract.

## Install and scaffold

```sh
npm install --global @tgbotpress/devkit
tgbotpress plugin create --id hello-world --name "Hello World" --description "Example plugin"
cd tgbotpress-plugin-hello-world
npm install
npm pack --dry-run
```

The command creates an ESM package with a manifest, root export, and declaration stub. Edit the generated package name to your npm scope before publishing. Scaffolding does not register functionality in a host.

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

The `create_tgbotpress_plugin` tool writes a starter package into the requested directory. Review the path and generated files before using it.

## Agent skill

Install the bundled skill into the current directory with:

```sh
tgbotpress skill install
```

Pass `-d <directory>` to choose another skills folder.

The package contains `skills/tgbotpress-plugin-development/SKILL.md`. Copy it into the agent's skills directory or install it through the agent's supported skill mechanism. Always consult the target TGBotPress host's current plugin guide and SDK; capabilities and trust rules can vary by host version.

Third-party plugin execution and dynamic installation require host-side integration and security isolation. This package creates source files only and does not install or activate code in a running platform.
