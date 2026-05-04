import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OtoboClient } from "./otobo-client.js";

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

export function registerTools(server: McpServer, client: OtoboClient) {
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
    "Get full ticket details by TicketID, including articles (communication history) and dynamic fields",
    {
      ticket_id: z.string().describe("The Otobo ticket ID"),
      include_articles: z.boolean().optional().describe("Include all articles/messages (default: true)"),
      include_dynamic_fields: z.boolean().optional().describe("Include dynamic fields (default: true)"),
      extended: z.boolean().optional().describe("Include extended information (default: false)"),
    },
    async (params) => {
      try {
        const result = await client.ticketGet(params.ticket_id, {
          AllArticles: params.include_articles !== false,
          DynamicFields: params.include_dynamic_fields !== false,
          Extended: params.extended,
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "create_ticket",
    "Create a new Otobo ticket with a first article (message)",
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
    },
    async (params) => {
      try {
        const result = await client.ticketCreate(
          {
            Title: params.title,
            Queue: params.queue,
            State: params.state || "new",
            Priority: params.priority || "3 normal",
            CustomerUser: params.customer_user,
            Type: params.type,
            Owner: params.owner,
            Responsible: params.responsible,
          },
          {
            Subject: params.article_subject || params.title,
            Body: params.article_body,
            ContentType: params.article_content_type || "text/plain; charset=utf-8",
            CommunicationChannel: params.communication_channel || "Email",
            SenderType: params.sender_type || "customer",
          }
        );
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_ticket",
    "Update an existing Otobo ticket (change state, queue, priority, owner, etc.) and optionally add a new article",
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
      article_subject: z.string().optional().describe("Subject for a new article to add"),
      article_body: z.string().optional().describe("Body for a new article to add"),
      article_content_type: z.string().optional().describe("Article content type (default: 'text/plain; charset=utf-8')"),
      communication_channel: z.string().optional().describe("Communication channel: 'Email', 'Phone', 'Internal' (default: 'Internal')"),
      sender_type: z.string().optional().describe("Sender type: 'agent', 'system', 'customer' (default: 'agent')"),
    },
    async (params) => {
      try {
        const ticketData: Record<string, unknown> = {};
        if (params.title) ticketData.Title = params.title;
        if (params.queue) ticketData.Queue = params.queue;
        if (params.state) ticketData.State = params.state;
        if (params.priority) ticketData.Priority = params.priority;
        if (params.owner) ticketData.Owner = params.owner;
        if (params.responsible) ticketData.Responsible = params.responsible;
        if (params.lock) ticketData.Lock = params.lock;
        if (params.type) ticketData.Type = params.type;
        if (params.customer_user) ticketData.CustomerUser = params.customer_user;
        if (params.pending_time) ticketData.PendingTime = params.pending_time;

        let article;
        if (params.article_body) {
          article = {
            Subject: params.article_subject || "Update",
            Body: params.article_body,
            ContentType: params.article_content_type || "text/plain; charset=utf-8",
            CommunicationChannel: params.communication_channel || "Internal",
            SenderType: params.sender_type || "agent",
          };
        }

        const result = await client.ticketUpdate(
          params.ticket_id,
          Object.keys(ticketData).length > 0 ? ticketData : undefined,
          article
        );
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // --- History ---

  server.tool(
    "get_ticket_history",
    "Get the full change history of a ticket (who changed what, when)",
    {
      ticket_id: z.string().describe("The Otobo ticket ID"),
    },
    async (params) => {
      try {
        const result = await client.ticketHistoryGet(params.ticket_id);
        return jsonResult(result);
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
    "Close a ticket by setting its state to 'closed successful' and optionally adding a closing note",
    {
      ticket_id: z.string().describe("The Otobo ticket ID to close"),
      note: z.string().optional().describe("Optional closing note/reason"),
      state: z.string().optional().describe("Close state (default: 'closed successful'). Use 'closed unsuccessful' for unresolved tickets."),
    },
    async (params) => {
      try {
        const closeState = params.state || "closed successful";
        let article;
        if (params.note) {
          article = {
            Subject: "Ticket closed",
            Body: params.note,
            ContentType: "text/plain; charset=utf-8",
            CommunicationChannel: "Internal",
            SenderType: "agent",
          };
        }

        const result = await client.ticketUpdate(
          params.ticket_id,
          { State: closeState },
          article
        );
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
        const result = await client.ticketUpdate(
          params.ticket_id,
          undefined,
          {
            Subject: params.subject || "Note",
            Body: params.body,
            ContentType: params.content_type || "text/plain; charset=utf-8",
            CommunicationChannel: "Internal",
            SenderType: "agent",
          }
        );
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
