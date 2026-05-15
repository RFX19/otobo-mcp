import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OtoboClient } from "./otobo-client.js";
import { addNote, closeTicket, runBulk, updateTicket } from "./services.js";

function jsonResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return jsonResult({ error: message }, true);
}

// --- Helpers: article post-processing -------------------------------------
// These run client-side on the MCP server after a TicketGet response,
// to keep responses small enough for LLM context windows.

function stripHtml(html: string): string {
  if (!html) return html;
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface ArticleProcessOptions {
  limit?: number;
  order?: "newest_first" | "oldest_first";
  senderTypes?: string[];
  stripHtml?: boolean;
}

function processTicketArticles(
  result: { Ticket?: Record<string, unknown>[] } & Record<string, unknown>,
  options: ArticleProcessOptions
): Record<string, unknown> {
  const tickets = result.Ticket || [];
  if (tickets.length === 0) return result;

  const ticket = tickets[0];
  if (!ticket || !Array.isArray((ticket as Record<string, unknown>).Article)) {
    return result;
  }

  let articles = (ticket as Record<string, unknown>).Article as Record<string, unknown>[];
  const totalCount = articles.length;

  // Filter by sender type
  let filteredCount = totalCount;
  if (options.senderTypes && options.senderTypes.length > 0) {
    const allowed = new Set(options.senderTypes.map((s) => s.toLowerCase()));
    articles = articles.filter((a) => {
      const st = typeof a.SenderType === "string" ? a.SenderType.toLowerCase() : "";
      return allowed.has(st);
    });
    filteredCount = articles.length;
  }

  // Otobo returns articles oldest_first (chronological); reverse for newest_first
  if (options.order !== "oldest_first") {
    articles = articles.slice().reverse();
  }

  // Limit
  if (typeof options.limit === "number" && options.limit >= 0) {
    articles = articles.slice(0, options.limit);
  }

  // Strip HTML from bodies
  if (options.stripHtml !== false) {
    articles = articles.map((a) => {
      const newArt: Record<string, unknown> = { ...a };
      const contentType = typeof a.ContentType === "string" ? a.ContentType.toLowerCase() : "";
      const mimeType = typeof a.MimeType === "string" ? a.MimeType.toLowerCase() : "";
      const isHtml = contentType.includes("text/html") || mimeType.includes("text/html");

      if (typeof a.Body === "string") {
        if (isHtml || /<\w+[\s>\/]/.test(a.Body)) {
          newArt.Body = stripHtml(a.Body);
        }
      }
      // Drop separate HTML body fields if present
      delete newArt.BodyHtml;
      delete newArt.HtmlBody;
      return newArt;
    });
  }

  const newTicket = { ...(ticket as Record<string, unknown>), Article: articles };

  return {
    ...result,
    Ticket: [newTicket],
    _articles_meta: {
      total_articles: totalCount,
      returned_articles: articles.length,
      filtered_by_sender_type: filteredCount !== totalCount,
      order: options.order || "newest_first",
      html_stripped: options.stripHtml !== false,
    },
  };
}

export interface RegisterToolsConfig {
  /** Default ticket state used when closing without an explicit state. Falls back to "closed successful". */
  defaultCloseState?: string;
}

export function registerTools(
  server: McpServer,
  client: OtoboClient,
  config: RegisterToolsConfig = {}
) {
  const defaultCloseState = config.defaultCloseState || "closed successful";
  // --- Core Ticket Tools ---

  server.tool(
    "search_tickets",
    "Search Otobo tickets by various criteria. Supports fulltext search across all fields, article-level filtering (subject/body/from/to), and traditional metadata filters (Queue, State, Priority, CustomerUser, Title, TicketNumber, date ranges, etc.)",
    {
      title: z.string().optional().describe("Search by ticket title (substring match)"),
      ticket_number: z.string().optional().describe("Search by exact ticket number"),
      fulltext: z.string().optional().describe("Fulltext search across Title, From, To, Cc, Subject and Body of all articles. Use '*' wildcards, e.g. '*8920712*'"),
      body: z.string().optional().describe("Search article bodies (substring or wildcard pattern, e.g. '*invoice*')"),
      subject: z.string().optional().describe("Search article subjects"),
      from: z.string().optional().describe("Search article From-Header (sender email/name)"),
      to: z.string().optional().describe("Search article To-Header"),
      cc: z.string().optional().describe("Search article Cc-Header"),
      queues: z.array(z.string()).optional().describe("Filter by queue names, e.g. ['Raw', 'Junk']"),
      states: z.array(z.string()).optional().describe("Filter by state names, e.g. ['new', 'open']"),
      priorities: z.array(z.string()).optional().describe("Filter by priority names, e.g. ['3 normal', '4 high']"),
      customer_user: z.string().optional().describe("Filter by customer user login"),
      customer_id: z.string().optional().describe("Filter by Customer-ID (Customer Company), e.g. 'CANCOM'"),
      types: z.array(z.string()).optional().describe("Filter by ticket types"),
      locks: z.array(z.string()).optional().describe("Filter by lock state: 'lock' or 'unlock'"),
      include_archived: z.boolean().optional().describe("Also search archived tickets (default: false, only non-archived)"),
      sort_by: z.string().optional().describe("Sort field, e.g. 'Age', 'Ticket', 'Created', 'Changed', 'Priority', 'Queue', 'State', 'Owner'"),
      order_by: z.enum(["Up", "Down"]).optional().describe("Sort order: 'Up' (ascending) or 'Down' (descending)"),
      limit: z.number().min(1).max(1000).optional().describe("Maximum number of results (default: 100)"),
      created_after: z.string().optional().describe("Only tickets created after this date (YYYY-MM-DD HH:MM:SS)"),
      created_before: z.string().optional().describe("Only tickets created before this date (YYYY-MM-DD HH:MM:SS)"),
      changed_after: z.string().optional().describe("Only tickets changed after this date (YYYY-MM-DD HH:MM:SS)"),
      changed_before: z.string().optional().describe("Only tickets changed before this date (YYYY-MM-DD HH:MM:SS)"),
    },
    async (params) => {
      try {
        const result = await client.ticketSearch({
          Title: params.title,
          TicketNumber: params.ticket_number,
          Fulltext: params.fulltext,
          MIMEBase_Body: params.body,
          MIMEBase_Subject: params.subject,
          MIMEBase_From: params.from,
          MIMEBase_To: params.to,
          MIMEBase_Cc: params.cc,
          Queues: params.queues,
          States: params.states,
          Priorities: params.priorities,
          CustomerUserLogin: params.customer_user,
          CustomerID: params.customer_id,
          Types: params.types,
          Locks: params.locks,
          ArchiveFlags: params.include_archived ? ["y", "n"] : undefined,
          SortBy: params.sort_by,
          OrderBy: params.order_by,
          Limit: params.limit,
          TicketCreateTimeNewerDate: params.created_after,
          TicketCreateTimeOlderDate: params.created_before,
          TicketLastChangeTimeNewerDate: params.changed_after,
          TicketLastChangeTimeOlderDate: params.changed_before,
        });
        const ticketIDs = result.TicketID || [];
        return jsonResult({
          count: ticketIDs.length,
          ticket_ids: ticketIDs,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_ticket",
    "Get full ticket details by TicketID, including articles (communication history) and dynamic fields. By default returns the 7 newest articles with HTML stripped to plaintext, to keep responses manageable for tickets with long mail threads.",
    {
      ticket_id: z.string().describe("The Otobo ticket ID"),
      include_articles: z.boolean().optional().describe("Include articles/messages (default: true)"),
      include_dynamic_fields: z.boolean().optional().describe("Include dynamic fields (default: true)"),
      extended: z.boolean().optional().describe("Include extended information (default: false)"),
      article_limit: z.number().min(0).max(100).optional().describe("Maximum number of articles to return (default: 7). Set to 0 to return only ticket metadata, no articles."),
      article_order: z.enum(["newest_first", "oldest_first"]).optional().describe("Article order. 'newest_first' (default) shows the most recent activity first. 'oldest_first' for chronological reading."),
      article_sender_types: z.array(z.enum(["customer", "agent", "system"])).optional().describe("Filter articles by sender type. E.g. ['customer'] for only customer mails, or ['customer','agent'] to skip system noise."),
      strip_html: z.boolean().optional().describe("Strip HTML tags from article bodies, returning plaintext only (default: true). Saves significant tokens on long mail threads."),
    },
    async (params) => {
      try {
        const includeArticles = params.include_articles !== false;
        const articleLimit = typeof params.article_limit === "number" ? params.article_limit : 7;

        const result = await client.ticketGet(params.ticket_id, {
          AllArticles: includeArticles && articleLimit > 0,
          DynamicFields: params.include_dynamic_fields !== false,
          Extended: params.extended,
        });

        if (!includeArticles || articleLimit === 0) {
          return jsonResult(result);
        }

        const processed = processTicketArticles(result, {
          limit: articleLimit,
          order: params.article_order || "newest_first",
          senderTypes: params.article_sender_types,
          stripHtml: params.strip_html !== false,
        });

        return jsonResult(processed);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "create_ticket",
    "Create a new Otobo ticket with a first article (message). Can also set DynamicFields on creation; if a DynamicField has an OTOBO Notification configured to fire on its update event, that notification will trigger immediately (useful for automated acknowledgement emails).",
    {
      title: z.string().describe("Ticket title/subject"),
      queue: z.string().describe("Queue name, e.g. 'Raw' or 'Postmaster'"),
      state: z.string().optional().describe("Ticket state (default: 'new')"),
      priority: z.string().optional().describe("Priority name (default: '3 normal')"),
      customer_user: z.string().describe("Customer user login or email"),
      type: z.string().optional().describe("Ticket type, if configured"),
      owner: z.string().optional().describe("Agent owner login"),
      responsible: z.string().optional().describe("Responsible agent login"),
      article_subject: z.string().optional().describe("Article subject (defaults to ticket title)"),
      article_body: z.string().describe("Article body text"),
      article_content_type: z.string().optional().describe("Content type (default: 'text/plain; charset=utf-8')"),
      communication_channel: z.string().optional().describe("Communication channel: 'Email', 'Phone', 'Internal' (default: 'Email')"),
      sender_type: z.string().optional().describe("Sender type: 'agent', 'system', 'customer' (default: 'customer')"),
      dynamic_fields: z.array(z.object({
        name: z.string().describe("DynamicField technical name (without 'DynamicField_' prefix), e.g. 'MCPReplyDraft'"),
        value: z.union([z.string(), z.array(z.string())]).describe("Field value. String for text/textarea/dropdown, array of strings for multi-select."),
      })).optional().describe("Set DynamicField values on creation. Useful for triggering OTOBO Notifications that fire on DynamicFieldUpdate events."),
    },
    async (params) => {
      try {
        const ticketData: Record<string, unknown> = {
          Title: params.title,
          Queue: params.queue,
          State: params.state || "new",
          Priority: params.priority || "3 normal",
          CustomerUser: params.customer_user,
          Type: params.type,
          Owner: params.owner,
          Responsible: params.responsible,
        };

        const dynamicFields = params.dynamic_fields && params.dynamic_fields.length > 0
          ? params.dynamic_fields.map((df) => ({ Name: df.name, Value: df.value }))
          : undefined;

        const result = await client.ticketCreate(
          ticketData as unknown as Parameters<typeof client.ticketCreate>[0],
          {
            Subject: params.article_subject || params.title,
            Body: params.article_body,
            ContentType: params.article_content_type || "text/plain; charset=utf-8",
            CommunicationChannel: params.communication_channel || "Email",
            SenderType: params.sender_type || "customer",
          },
          dynamicFields
        );
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_ticket",
    "Update an existing Otobo ticket (change state, queue, priority, owner, set DynamicFields, etc.) and optionally add a new article.\n\nIMPORTANT — Sending customer reply emails: A normal `article_body` with `communication_channel: 'Email'` only writes the article to the database; it does NOT trigger SMTP send. To actually send an email reply to the customer, set a DynamicField that has an associated OTOBO Notification configured to fire on its update event (`TicketDynamicFieldUpdate_<FieldName>`). The notification sends the email via OTOBO's full SMTP pipeline with proper threading headers. By convention, this server's README recommends the DynamicField name 'MCPReplyDraft' — but the actual field name depends on your OTOBO setup. See the project README section 'Sending Customer Replies via OTOBO Notifications' for full setup. Include a short signature at the end of the reply text, since the OTOBO Notification engine does NOT append queue signatures automatically.",
    {
      ticket_id: z.string().describe("The Otobo ticket ID to update"),
      title: z.string().optional().describe("New ticket title"),
      queue: z.string().optional().describe("Move to queue"),
      state: z.string().optional().describe("New state, e.g. 'open', 'pending reminder', 'closed successful'"),
      priority: z.string().optional().describe("New priority"),
      owner: z.string().optional().describe("New owner agent login"),
      responsible: z.string().optional().describe("New responsible agent login"),
      lock: z.string().optional().describe("Lock state: 'lock' or 'unlock'"),
      type: z.string().optional().describe("New ticket type"),
      customer_user: z.string().optional().describe("Change customer user"),
      pending_time: z.string().optional().describe("Pending time for pending states (YYYY-MM-DD HH:MM:SS)"),
      dynamic_fields: z.array(z.object({
        name: z.string().describe("DynamicField technical name (without 'DynamicField_' prefix), e.g. 'MCPReplyDraft'"),
        value: z.union([z.string(), z.array(z.string())]).describe("Field value. String for text/textarea/dropdown, array of strings for multi-select. Pass empty string to clear."),
      })).optional().describe("Set or update DynamicField values. Setting a DynamicField fires the OTOBO event 'TicketDynamicFieldUpdate_<FieldName>' which can be used to trigger Notifications (e.g. send a customer reply — see README)."),
      article_subject: z.string().optional().describe("Subject for a new article to add"),
      article_body: z.string().optional().describe("Body for a new article to add"),
      article_content_type: z.string().optional().describe("Article content type (default: 'text/plain; charset=utf-8')"),
      communication_channel: z.string().optional().describe("Communication channel: 'Email', 'Phone', 'Internal' (default: 'Internal')"),
      sender_type: z.string().optional().describe("Sender type: 'agent', 'system', 'customer' (default: 'agent')"),
    },
    async (params) => {
      try {
        const result = await updateTicket(client, {
          ticketId: params.ticket_id,
          title: params.title,
          queue: params.queue,
          state: params.state,
          priority: params.priority,
          owner: params.owner,
          responsible: params.responsible,
          lock: params.lock,
          type: params.type,
          customerUser: params.customer_user,
          pendingTime: params.pending_time,
          dynamicFields: params.dynamic_fields,
          articleSubject: params.article_subject,
          articleBody: params.article_body,
          articleContentType: params.article_content_type,
          communicationChannel: params.communication_channel,
          senderType: params.sender_type,
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // --- History ---

  server.tool(
    "get_ticket_history",
    "Get the full change history of a ticket (who changed what, when). Articles are filtered by default like in get_ticket to keep responses manageable.",
    {
      ticket_id: z.string().describe("The Otobo ticket ID"),
      article_limit: z.number().min(0).max(100).optional().describe("Maximum number of articles to return alongside history (default: 7). Set to 0 to return only history without article bodies."),
      article_order: z.enum(["newest_first", "oldest_first"]).optional().describe("Article order (default: 'newest_first')"),
      article_sender_types: z.array(z.enum(["customer", "agent", "system"])).optional().describe("Filter articles by sender type"),
      strip_html: z.boolean().optional().describe("Strip HTML from article bodies (default: true)"),
    },
    async (params) => {
      try {
        const result = await client.ticketHistoryGet(params.ticket_id);
        const articleLimit = typeof params.article_limit === "number" ? params.article_limit : 7;

        const processed = processTicketArticles(
          result as { Ticket?: Record<string, unknown>[] } & Record<string, unknown>,
          {
            limit: articleLimit,
            order: params.article_order || "newest_first",
            senderTypes: params.article_sender_types,
            stripHtml: params.strip_html !== false,
          }
        );

        return jsonResult(processed);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // --- Metadata Tools ---

  server.tool(
    "list_queues",
    "List available Otobo queues by searching for tickets across all queues. Returns queue names found in the system.",
    async () => {
      try {
        // Search for any ticket to discover queues via TicketGet
        const searchResult = await client.ticketSearch({ Limit: 50 });
        const ticketIDs = searchResult.TicketID || [];
        if (ticketIDs.length === 0) {
          return jsonResult({ queues: [], message: "No tickets found. Cannot discover queues from an empty system." });
        }

        const queues = new Set<string>();
        // Get details for found tickets to extract queue names
        for (const id of ticketIDs.slice(0, 20)) {
          try {
            const ticketResult = await client.ticketGet(id, { AllArticles: false, DynamicFields: false });
            const tickets = ticketResult.Ticket || [];
            for (const ticket of tickets) {
              if (ticket.Queue && typeof ticket.Queue === "string") {
                queues.add(ticket.Queue);
              }
            }
          } catch {
            // Skip tickets we can't access
          }
        }
        return jsonResult({ queues: Array.from(queues).sort() });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "list_states",
    "List available Otobo ticket states by examining existing tickets. Returns state names found in the system.",
    async () => {
      try {
        const searchResult = await client.ticketSearch({ Limit: 100 });
        const ticketIDs = searchResult.TicketID || [];
        if (ticketIDs.length === 0) {
          return jsonResult({
            states: [
              "new", "open", "pending reminder", "pending auto close+",
              "pending auto close-", "closed successful", "closed unsuccessful",
              "merged", "removed",
            ],
            message: "No tickets found. Showing default Otobo states.",
          });
        }

        const states = new Set<string>();
        for (const id of ticketIDs.slice(0, 30)) {
          try {
            const ticketResult = await client.ticketGet(id, { AllArticles: false, DynamicFields: false });
            const tickets = ticketResult.Ticket || [];
            for (const ticket of tickets) {
              if (ticket.State && typeof ticket.State === "string") {
                states.add(ticket.State);
              }
            }
          } catch {
            // Skip tickets we can't access
          }
        }

        // Always include common default states
        const defaultStates = [
          "new", "open", "pending reminder", "closed successful", "closed unsuccessful",
        ];
        for (const s of defaultStates) states.add(s);

        return jsonResult({ states: Array.from(states).sort() });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "list_priorities",
    "List available Otobo ticket priorities by examining existing tickets. Returns priority names found in the system.",
    async () => {
      try {
        const searchResult = await client.ticketSearch({ Limit: 100 });
        const ticketIDs = searchResult.TicketID || [];
        if (ticketIDs.length === 0) {
          return jsonResult({
            priorities: [
              "1 very low", "2 low", "3 normal", "4 high", "5 very high",
            ],
            message: "No tickets found. Showing default Otobo priorities.",
          });
        }

        const priorities = new Set<string>();
        for (const id of ticketIDs.slice(0, 30)) {
          try {
            const ticketResult = await client.ticketGet(id, { AllArticles: false, DynamicFields: false });
            const tickets = ticketResult.Ticket || [];
            for (const ticket of tickets) {
              if (ticket.Priority && typeof ticket.Priority === "string") {
                priorities.add(ticket.Priority);
              }
            }
          } catch {
            // Skip tickets we can't access
          }
        }

        // Always include common defaults
        const defaultPriorities = [
          "1 very low", "2 low", "3 normal", "4 high", "5 very high",
        ];
        for (const p of defaultPriorities) priorities.add(p);

        return jsonResult({ priorities: Array.from(priorities).sort() });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // --- Convenience Tools ---

  server.tool(
    "close_ticket",
    `Close a ticket by setting its state to '${defaultCloseState}' and optionally adding a closing note. The default state is configurable via the OTOBO_DEFAULT_CLOSE_STATE env var (useful for localized installations where 'closed successful' is not defined — e.g. set to 'geschlossen - erfolgreich' on German setups).`,
    {
      ticket_id: z.string().describe("The Otobo ticket ID to close"),
      note: z.string().optional().describe("Optional closing note/reason"),
      state: z.string().optional().describe(`Close state (default: '${defaultCloseState}'). Use 'closed unsuccessful' for unresolved tickets.`),
    },
    async (params) => {
      try {
        const result = await closeTicket(client, {
          ticketId: params.ticket_id,
          state: params.state || defaultCloseState,
          note: params.note,
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "add_note",
    "Add an internal note to a ticket without changing its state",
    {
      ticket_id: z.string().describe("The Otobo ticket ID"),
      subject: z.string().optional().describe("Note subject (default: 'Note')"),
      body: z.string().describe("Note body text"),
      content_type: z.string().optional().describe("Content type (default: 'text/plain; charset=utf-8')"),
    },
    async (params) => {
      try {
        const result = await addNote(client, {
          ticketId: params.ticket_id,
          body: params.body,
          subject: params.subject,
          contentType: params.content_type,
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // --- Bulk Tools -----------------------------------------------------------
  // These run multiple TicketUpdate calls in parallel with a concurrency cap.
  // Use for routine bulk operations (closing batches of Amazon FBA notification
  // tickets, payout-confirmation mails, queue moves, mass priority changes).
  // For single tickets, prefer close_ticket / update_ticket / add_note —
  // they have richer descriptions and clearer error semantics.

  const ticketIdsSchema = z
    .array(z.string())
    .min(1)
    .max(100)
    .describe("Ticket IDs to operate on (1-100). All tickets are processed in parallel (concurrency cap 10).");

  server.tool(
    "close_tickets_bulk",
    `Close multiple tickets in parallel. Intended for routine bulk close-outs (e.g. dozens of Amazon-FBA notifications, payout-confirmation mails, automated alerts). Each ticket gets an individual status in the response — a single failure does not abort the batch. For single tickets, prefer \`close_ticket\`. Default close state is '${defaultCloseState}' (configurable via the OTOBO_DEFAULT_CLOSE_STATE env var — set this for localized installations where 'closed successful' is not defined, e.g. 'geschlossen - erfolgreich' on German setups).`,
    {
      ticket_ids: ticketIdsSchema,
      state: z.string().optional().describe(`Close state (default: '${defaultCloseState}')`),
      note: z.string().optional().describe("Optional closing note added to every ticket"),
    },
    async (params) => {
      try {
        const state = params.state || defaultCloseState;
        const response = await runBulk(params.ticket_ids, (ticketId) =>
          closeTicket(client, { ticketId, state, note: params.note })
        );
        return jsonResult(response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_tickets_bulk",
    "Apply the same ticket-level updates to multiple tickets in parallel — bulk queue moves, bulk reassign, bulk priority changes, bulk DynamicField updates. Article-specific fields are NOT supported here; use `add_notes_bulk` to attach the same note to many tickets. Each ticket gets an individual status in the response. For single tickets, prefer `update_ticket`.",
    {
      ticket_ids: ticketIdsSchema,
      title: z.string().optional().describe("New ticket title (applied to all)"),
      queue: z.string().optional().describe("Move all tickets to this queue"),
      state: z.string().optional().describe("New state for all tickets"),
      priority: z.string().optional().describe("New priority for all tickets"),
      owner: z.string().optional().describe("New owner agent login for all tickets"),
      responsible: z.string().optional().describe("New responsible agent login for all tickets"),
      lock: z.string().optional().describe("Lock state: 'lock' or 'unlock'"),
      type: z.string().optional().describe("New ticket type"),
      customer_user: z.string().optional().describe("Change customer user for all tickets"),
      pending_time: z.string().optional().describe("Pending time (YYYY-MM-DD HH:MM:SS)"),
      dynamic_fields: z.array(z.object({
        name: z.string().describe("DynamicField technical name (without 'DynamicField_' prefix)"),
        value: z.union([z.string(), z.array(z.string())]).describe("Field value applied to every ticket"),
      })).optional().describe("Set the same DynamicField values on every ticket. Note: per-ticket reply drafts via MCPReplyDraft do NOT make sense here — every recipient would receive identical text."),
    },
    async (params) => {
      try {
        const response = await runBulk(params.ticket_ids, (ticketId) =>
          updateTicket(client, {
            ticketId,
            title: params.title,
            queue: params.queue,
            state: params.state,
            priority: params.priority,
            owner: params.owner,
            responsible: params.responsible,
            lock: params.lock,
            type: params.type,
            customerUser: params.customer_user,
            pendingTime: params.pending_time,
            dynamicFields: params.dynamic_fields,
          })
        );
        return jsonResult(response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "add_notes_bulk",
    "Add the same internal note to multiple tickets in parallel. Useful for bulk-tagging tickets with the same audit comment (e.g. 'reviewed by AI', 'related to incident XY'). Each ticket gets an individual status in the response. For single tickets, prefer `add_note`.",
    {
      ticket_ids: ticketIdsSchema,
      body: z.string().describe("Note body text (applied to every ticket)"),
      subject: z.string().optional().describe("Note subject (default: 'Note')"),
      content_type: z.string().optional().describe("Content type (default: 'text/plain; charset=utf-8')"),
    },
    async (params) => {
      try {
        const response = await runBulk(params.ticket_ids, (ticketId) =>
          addNote(client, {
            ticketId,
            body: params.body,
            subject: params.subject,
            contentType: params.content_type,
          })
        );
        return jsonResult(response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
