#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OtoboClient } from "./otobo-client.js";
import { registerTools } from "./tools.js";

// Allow self-signed / internal certificates
if (process.env.OTOBO_UNSAFE_SSL === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const server = new McpServer({
  name: "mcp-otobo",
  version: "1.0.0",
  description: "MCP server for Otobo ticket system",
});

function getEnv(name: string, defaultValue?: string): string {
  const value = process.env[name] || defaultValue;
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const client = new OtoboClient({
  baseUrl: getEnv("OTOBO_BASE_URL"),
  username: getEnv("OTOBO_USERNAME"),
  password: getEnv("OTOBO_PASSWORD"),
  webservice: getEnv("OTOBO_WEBSERVICE", "GenericTicketConnectorREST"),
});

registerTools(server, client, {
  defaultCloseState: process.env.OTOBO_DEFAULT_CLOSE_STATE,
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-otobo server running on stdio");

  // Verify credentials (non-blocking — server stays running either way)
  client.ticketSearch({ Limit: 1 }).then(
    () => console.error("mcp-otobo: connection to Otobo verified"),
    (error) => console.error(`mcp-otobo: WARNING — could not verify Otobo connection: ${error instanceof Error ? error.message : String(error)}`)
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
