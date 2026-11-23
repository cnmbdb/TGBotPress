import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { scaffoldPlugin } from './index.js'
import { resolve } from 'node:path'
const server = new McpServer({ name:'tgbotpress-mcp', version:'0.1.0' })
server.tool('create_tgbotpress_plugin','Scaffold a TGBotPress ESM plugin package',{ id:z.string(), name:z.string(), description:z.string().optional(), directory:z.string() },async args=>{const path=await scaffoldPlugin({...args,directory:resolve(args.directory)});return {content:[{type:'text',text:`Created plugin at ${path}`}]} })
await server.connect(new StdioServerTransport())
