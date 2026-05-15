# mcp-otobo

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [Otobo](https://otobo.io/) — the open-source ITSM and helpdesk system. This server enables AI assistants to search, create, update, and manage tickets in your Otobo instance through the Generic Interface REST API.

## Features

- **Search tickets** by queue, state, priority, customer, title, date ranges, and more
- **Get ticket details** including full communication history and dynamic fields
- **Create tickets** with initial articles
- **Update tickets** — change state, queue, priority, owner, add articles
- **Close tickets** with optional closing notes
- **Add internal notes** to tickets
- **View ticket history** — full audit trail of changes
- **List queues, states, and priorities** from your Otobo instance
- **Bulk operations** — close, update, or note up to 100 tickets in a single call (parallelized, partial-failure tolerant)

## Prerequisites

- **Node.js** 18 or later
- An **Otobo instance** with a configured Generic Interface web service (see [Otobo Setup](#otobo-setup))
- An **agent account** with API access permissions

## Installation

```bash
npm install -g mcp-otobo
```

Or run directly with npx:

```bash
npx mcp-otobo
```

Or clone and build from source:

```bash
git clone https://github.com/domnussbaum/otobo-mcp.git
cd mcp-otobo
npm install
npm run build
```

## Configuration

The server is configured via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `OTOBO_BASE_URL` | Yes | — | Your Otobo instance URL (e.g. `https://otobo.example.com`) |
| `OTOBO_USERNAME` | Yes | — | Agent username for API access |
| `OTOBO_PASSWORD` | Yes | — | Agent password |
| `OTOBO_WEBSERVICE` | No | `GenericTicketConnectorREST` | Web service name configured in Otobo |
| `OTOBO_UNSAFE_SSL` | No | `false` | Set to `true` to allow self-signed/internal SSL certificates |
| `OTOBO_DEFAULT_CLOSE_STATE` | No | `closed successful` | Default state used by `close_ticket` and `close_tickets_bulk` when no `state` is passed. Set to your localized variant (e.g. `geschlossen - erfolgreich`) on installations where the English default is not configured. Discover valid values with `list_states`. |

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

## Available Tools

### Core Ticket Operations

| Tool | Description |
|---|---|
| `search_tickets` | Search tickets by queue, state, priority, customer, title, ticket number, date ranges |
| `get_ticket` | Get full ticket details with articles and dynamic fields |
| `create_ticket` | Create a new ticket with first article |
| `update_ticket` | Update ticket fields and optionally add an article |

### History

| Tool | Description |
|---|---|
| `get_ticket_history` | Get the full change history of a ticket |

### Metadata

| Tool | Description |
|---|---|
| `list_queues` | List available queues in the system |
| `list_states` | List available ticket states |
| `list_priorities` | List available ticket priorities |

### Convenience

| Tool | Description |
|---|---|
| `close_ticket` | Close a ticket with an optional note |
| `add_note` | Add an internal note to a ticket |

### Bulk Operations

For routine batch work — closing dozens of Amazon-FBA notifications, payout-confirmation mails, moving many tickets between queues — the bulk tools run up to 100 tickets per call, parallelized across the OTOBO API with a concurrency cap of 10. A single failing ticket does not abort the batch; each ticket gets its own status in the response.

| Tool | Description |
|---|---|
| `close_tickets_bulk` | Close many tickets at once (optional shared closing note) |
| `update_tickets_bulk` | Apply the same field updates to many tickets (queue move, reassign, priority change, DynamicField set) |
| `add_notes_bulk` | Attach the same internal note to many tickets |

All three return a standardized response:

```json
{
  "succeeded": [
    { "ticket_id": "72336", "ticket_number": "2026051592000108" }
  ],
  "failed": [
    { "ticket_id": "72337", "error": "Ticket not found" }
  ],
  "summary": { "total": 13, "succeeded_count": 12, "failed_count": 1 }
}
```

For single tickets, prefer `close_ticket` / `update_ticket` / `add_note` — they have richer descriptions and clearer error semantics.

**Example — close a batch of Amazon FBA notification tickets:**

```json
{
  "ticket_ids": ["72336", "72337", "72338", "72339"],
  "note": "Auto-closed: routine FBA inbound notification, no action needed."
}
```

**Example — move multiple tickets to a different queue:**

```json
{
  "ticket_ids": ["72341", "72342", "72343"],
  "queue": "Misc",
  "priority": "2 low"
}
```

## Integration Examples

### Claude Desktop

Add to your `claude_desktop_config.json`:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "otobo": {
      "command": "npx",
      "args": ["-y", "mcp-otobo"],
      "env": {
        "OTOBO_BASE_URL": "https://otobo.example.com",
        "OTOBO_USERNAME": "your-agent-user",
        "OTOBO_PASSWORD": "your-agent-password",
        "OTOBO_WEBSERVICE": "GenericTicketConnectorREST"
      }
    }
  }
}
```

Or if installed from source:

```json
{
  "mcpServers": {
    "otobo": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-otobo/build/index.js"],
      "env": {
        "OTOBO_BASE_URL": "https://otobo.example.com",
        "OTOBO_USERNAME": "your-agent-user",
        "OTOBO_PASSWORD": "your-agent-password"
      }
    }
  }
}
```

### Claude Code

Add to your project's `.mcp.json` file:

```json
{
  "mcpServers": {
    "otobo": {
      "command": "npx",
      "args": ["-y", "mcp-otobo"],
      "env": {
        "OTOBO_BASE_URL": "https://otobo.example.com",
        "OTOBO_USERNAME": "your-agent-user",
        "OTOBO_PASSWORD": "your-agent-password",
        "OTOBO_WEBSERVICE": "GenericTicketConnectorREST"
      }
    }
  }
}
```

Or add it via the CLI with environment variables:

```bash
claude mcp add otobo \
  -e OTOBO_BASE_URL=https://otobo.example.com \
  -e OTOBO_USERNAME=your-agent-user \
  -e 'OTOBO_PASSWORD=your-agent-password' \
  -e OTOBO_WEBSERVICE=GenericTicketConnectorREST \
  -- npx -y mcp-otobo
```

### Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "otobo": {
      "command": "npx",
      "args": ["-y", "mcp-otobo"],
      "env": {
        "OTOBO_BASE_URL": "https://otobo.example.com",
        "OTOBO_USERNAME": "your-agent-user",
        "OTOBO_PASSWORD": "your-agent-password",
        "OTOBO_WEBSERVICE": "GenericTicketConnectorREST"
      }
    }
  }
}
```

### Windsurf

Add to your Windsurf MCP configuration (`~/.windsurf/mcp.json`):

```json
{
  "mcpServers": {
    "otobo": {
      "command": "npx",
      "args": ["-y", "mcp-otobo"],
      "env": {
        "OTOBO_BASE_URL": "https://otobo.example.com",
        "OTOBO_USERNAME": "your-agent-user",
        "OTOBO_PASSWORD": "your-agent-password",
        "OTOBO_WEBSERVICE": "GenericTicketConnectorREST"
      }
    }
  }
}
```

### ChatGPT / OpenAI (via MCP Bridge)

ChatGPT does not natively support MCP. However, third-party MCP-to-OpenAI bridge tools exist that can expose any MCP server as an OpenAI-compatible function-calling API. Search for "MCP OpenAI bridge" or "MCP proxy" for current options.

### Codex CLI

Set up environment variables and configure MCP in your Codex configuration:

```bash
export OTOBO_BASE_URL=https://otobo.example.com
export OTOBO_USERNAME=your-agent-user
export OTOBO_PASSWORD='your-agent-password'

codex --full-auto "Search for open tickets"
```

Or add to your `~/.codex/config.json`:

```json
{
  "mcpServers": {
    "otobo": {
      "command": "npx",
      "args": ["-y", "mcp-otobo"],
      "env": {
        "OTOBO_BASE_URL": "https://otobo.example.com",
        "OTOBO_USERNAME": "your-agent-user",
        "OTOBO_PASSWORD": "your-agent-password",
        "OTOBO_WEBSERVICE": "GenericTicketConnectorREST"
      }
    }
  }
}
```

### Gemini CLI

Add to your Gemini CLI MCP settings file (`~/.gemini/settings.json`):

```json
{
  "mcpServers": {
    "otobo": {
      "command": "npx",
      "args": ["-y", "mcp-otobo"],
      "env": {
        "OTOBO_BASE_URL": "https://otobo.example.com",
        "OTOBO_USERNAME": "your-agent-user",
        "OTOBO_PASSWORD": "your-agent-password",
        "OTOBO_WEBSERVICE": "GenericTicketConnectorREST"
      }
    }
  }
}
```

### Generic MCP Client

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "mcp-otobo"],
  env: {
    OTOBO_BASE_URL: "https://otobo.example.com",
    OTOBO_USERNAME: "your-agent-user",
    OTOBO_PASSWORD: "your-agent-password",
    OTOBO_WEBSERVICE: "GenericTicketConnectorREST",
  },
});

const client = new Client({ name: "my-app", version: "1.0.0" });
await client.connect(transport);

// List available tools
const tools = await client.listTools();
console.log(tools);

// Search for open tickets
const result = await client.callTool("search_tickets", {
  states: ["open", "new"],
  limit: 10,
});
console.log(result);
```

## Otobo Setup

To use this MCP server, your Otobo instance needs a properly configured **Generic Interface** web service.

### Step 1: Create a Web Service

1. Log in to Otobo as an admin
2. Navigate to **Admin → Generic Interface → Web Services**
3. Click **Add Web Service**
4. Set:
   - **Name**: `GenericTicketConnectorREST` (or your preferred name — must match `OTOBO_WEBSERVICE`)
   - **Network Transport**: `HTTP::REST`

### Step 2: Add Operations

Add the following four operations to your web service. For each one:

1. Click **Add Operation**
2. Set the **Name** (e.g. `TicketCreate`)
3. Select the **Operation-Backend**:

| Name | Operation-Backend |
|---|---|
| `TicketCreate` | `Ticket::TicketCreate` |
| `TicketGet` | `Ticket::TicketGet` |
| `TicketSearch` | `Ticket::TicketSearch` |
| `TicketUpdate` | `Ticket::TicketUpdate` |

4. Leave mapping settings at their defaults
5. Click **Save**

### Step 3: Configure Transport & Route Mapping

1. Back on the web service overview, go to **Network Transport → Configure**
2. Set **Maximum message length**: `10000000` (or higher for large tickets)
3. Configure the **Route mapping** for each operation:

| Operation | Route | Request Method |
|---|---|---|
| `TicketCreate` | `/TicketCreate` | `POST` |
| `TicketGet` | `/TicketGet` | `POST` |
| `TicketSearch` | `/TicketSearch` | `POST` |
| `TicketUpdate` | `/TicketUpdate` | `POST` |

4. Save

### Step 4: Create an API Agent

> **Security note:** Once a REST web service is active, **any valid agent account** can authenticate against it. There is no way to restrict the web service itself to specific users. Access control is handled entirely through group and queue permissions. It is strongly recommended to create a dedicated API agent with minimal permissions.

1. Navigate to **Admin → Agents**
2. Create a dedicated agent account for API access (e.g. `api-user`)
3. Create a dedicated group (e.g. `api-access`) under **Admin → Groups**
4. Under **Admin → Agents ↔ Groups**, assign only the API agent to this group
5. Under **Admin → Queues ↔ Groups**, grant access only to the queues the API should reach
6. Use this agent's credentials for `OTOBO_USERNAME` and `OTOBO_PASSWORD`

### Step 5: Verify

Test your setup with curl:

```bash
curl -X POST \
  "https://otobo.example.com/otobo/nph-genericinterface.pl/Webservice/GenericTicketConnectorREST/TicketSearch" \
  -H "Content-Type: application/json" \
  -d '{"UserLogin":"your-agent","Password":"your-password"}'
```

You should get a JSON response with ticket IDs.

## Sending Customer Replies via OTOBO Notifications

The OTOBO REST API's `TicketUpdate` and `TicketCreate` operations write article data to the database but do NOT trigger SMTP email sending — that pipeline is only invoked by OTOBO's frontend `AgentTicketCompose` action or by its Notification engine.

This server's `update_ticket` and `create_ticket` tools can write to DynamicFields, which fire `TicketDynamicFieldUpdate_<FieldName>` events. By configuring an OTOBO Notification to listen for that event, you can send real customer-facing emails through your LLM with proper threading, queue email address, and SMTP logging — without needing custom OTOBO modules or external SMTP setup.

### Setup

#### 1. Create a DynamicField for the reply draft

In Otobo, navigate to **Admin → Ticket Settings → Dynamic Fields**:

- Select **Ticket** → **Textarea** → **Add**
- **Name**: `MCPReplyDraft` (recommended convention — but any name works as long as it matches your tool call)
- **Label**: `MCP Reply Draft`
- **Validity**: `valid`
- **Rows / Columns**: e.g. 15 / 80

Save.

#### 2. Make the field visible in the agent UI (optional, helpful for debugging)

- **Admin → System Configuration**
- Search for: `Ticket::Frontend::AgentTicketZoom###DynamicField`
- Add `MCPReplyDraft` with value `1`
- Deploy the configuration

#### 3. Configure the Notification

**Admin → Communication & Notifications → Ticket Notifications → Add**

- **Name**: `Send customer reply (MCPReplyDraft)`
- **Event**: `TicketDynamicFieldUpdate_MCPReplyDraft`
- **Recipients → Send to**: `Customer User of the Ticket`
- **Notification methods → Email**: enabled
- **Email sender**: `System address` (uses the queue's configured email address)

Notification template (under the per-language block):

- **Subject**: `Re: <OTOBO_TICKET_Title> [Ticket#<OTOBO_TICKET_TicketNumber>]`
- **Body**: switch the rich text editor to **Source Mode** before editing — otherwise the editor strips the placeholder tag thinking it's unknown HTML. Then enter:

  ```html
  <div style="white-space: pre-wrap; font-family: sans-serif;">&lt;OTOBO_TICKET_DynamicField_MCPReplyDraft_Value&gt;</div>
  ```

  The HTML entities `&lt;` and `&gt;` are required — OTOBO decodes them to `<` and `>` at render time, but the raw `<` would otherwise be interpreted as a malformed HTML tag and stripped by the editor on save.

Save the notification.

#### 4. Send a reply

The LLM can now send an email reply by calling `update_ticket` **as an isolated call** (no other ticket fields in the same call — see gotchas below):

```json
{
  "ticket_id": "12345",
  "dynamic_fields": [
    {
      "name": "MCPReplyDraft",
      "value": "Dear customer,\n\nthank you for reaching out. ...\n\nKind regards,\nYour Name"
    }
  ]
}
```

The notification fires synchronously: the email is built using the field content, sent via OTOBO's SMTP pipeline, and logged as an outgoing article in the ticket history. When the customer replies, OTOBO's PostMaster automatically routes the reply back to the same ticket via the ticket number in the subject.

### Notes and gotchas

- **Set the reply field in an isolated call.** Combining the DynamicField update with a state change, lock change, or other ticket field changes in the same `update_ticket` call is unreliable — the notification may not fire (depends on internal processing order in your OTOBO version). Always send the reply DynamicField alone, then do any state/lock/owner changes in a second call afterwards.
- **The notification fires only on actual value changes.** Setting the DynamicField to the same value it already has produces no event — OTOBO de-duplicates. If you need to re-send the same text (e.g. after a misconfiguration), introduce a minimal change like a trailing whitespace; do NOT set the value to an empty string as a "reset" — that triggers the notification with an empty body and sends an empty email to the customer.
- **No automatic queue signature.** The Notification engine does NOT append the queue's `Signature` field — that's only added by frontend `AgentTicketCompose`. Either include a short signature at the end of the reply text, or hard-code a footer block (with HRA / VAT-ID / legal info) directly in the notification template body. There is no `<OTOBO_QUEUE_Signature>` placeholder for notifications.
- **CKEditor strips unknown tags.** Always edit the notification body in Source Mode and use HTML-encoded angle brackets (`&lt;` / `&gt;`) around OTOBO placeholders. WYSIWYG mode silently strips them.
- **Renaming the DynamicField requires updating the notification event.** If you rename the field, OTOBO does NOT automatically update the notification's event subscription — the event field becomes empty and the notification stops firing silently. Always re-select the event from the dropdown after renaming.
- **State name strings are language-dependent.** OTOBO installations with German (or other localized) configurations may have state names like `geschlossen - erfolgreich` instead of `closed successful`. Use `list_states` to discover the valid values for your instance.
- **Threading depends on the subject pattern.** The `Re: ... [Ticket#NNN]` format is required so OTOBO's PostMaster can recognize incoming replies and route them to the correct ticket.
- **API user permissions.** The agent account only needs `note`-level permission on the queue (or higher). The `compose` permission is NOT required for this pattern, since the notification engine — not the user — performs the SMTP send.
- **Notification scope.** By default the notification fires for every ticket where the DynamicField is updated. To restrict to specific queues, use the notification's **Ticket Filter → Queue** setting.
- **Outbound side effects.** Other configured notifications may also fire on ticket actions (e.g. "Owner Updated"). Review your `Admin → Ticket Notifications` list to make sure no unintended notifications target customers.

## Troubleshooting

### "Missing required environment variable"

Make sure all required environment variables are set. Check that your MCP client configuration passes the `env` block correctly.

### "Otobo API error (HTTP 403)"

Your agent account may lack the necessary permissions. Check:
- The agent exists and is valid in Otobo
- The agent has group permissions for the queues you're trying to access
- The web service is active (not deactivated)

### "Otobo API error (HTTP 404)"

The web service endpoint is not found. Verify:
- The web service name matches `OTOBO_WEBSERVICE`
- The operations are configured with correct route mappings
- The Otobo URL is correct and accessible

### "Otobo API error (HTTP 500)"

An internal server error in Otobo. Check:
- Otobo system logs (`/opt/otobo/var/log/` or your log directory)
- The request payload is valid (required fields like Queue, State, Priority)
- Customer user exists in the system when creating tickets

### Connection Issues

- Ensure your Otobo instance is reachable from the machine running the MCP server
- Check for firewalls, VPN requirements, or SSL certificate issues
- For self-signed or internal SSL certificates, set `OTOBO_UNSAFE_SSL=true` in your environment configuration

### "No tickets found" for list_queues/list_states/list_priorities

These metadata tools discover values from existing tickets. If your system has no tickets yet, they return default values. Create a test ticket first, or use the known defaults:

- **Queues**: `Raw`, `Junk`, `Misc`, `Postmaster` (depends on your setup)
- **States**: `new`, `open`, `pending reminder`, `closed successful`, `closed unsuccessful`
- **Priorities**: `1 very low`, `2 low`, `3 normal`, `4 high`, `5 very high`

## License

MIT
