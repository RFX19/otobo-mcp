import { OtoboClient, TicketData, TicketArticle } from "./otobo-client.js";

// Reusable service functions that wrap the OtoboClient operations with the
// same business defaults used by the single-ticket MCP tools. Both the
// single-tool handlers and the bulk-tool handlers call these so behavior
// stays in lockstep.

export interface DynamicFieldInput {
  name: string;
  value: string | string[];
}

export interface CloseTicketParams {
  ticketId: string;
  state?: string;
  note?: string;
}

export async function closeTicket(client: OtoboClient, params: CloseTicketParams) {
  const article: TicketArticle | undefined = params.note
    ? {
        Subject: "Ticket closed",
        Body: params.note,
        ContentType: "text/plain; charset=utf-8",
        CommunicationChannel: "Internal",
        SenderType: "agent",
      }
    : undefined;

  return client.ticketUpdate(
    params.ticketId,
    { State: params.state || "closed successful" },
    article
  );
}

export interface UpdateTicketParams {
  ticketId: string;
  title?: string;
  queue?: string;
  state?: string;
  priority?: string;
  owner?: string;
  responsible?: string;
  lock?: string;
  type?: string;
  customerUser?: string;
  pendingTime?: string;
  dynamicFields?: DynamicFieldInput[];
  articleSubject?: string;
  articleBody?: string;
  articleContentType?: string;
  communicationChannel?: string;
  senderType?: string;
}

export async function updateTicket(client: OtoboClient, params: UpdateTicketParams) {
  const ticketData: TicketData = {};
  if (params.title) ticketData.Title = params.title;
  if (params.queue) ticketData.Queue = params.queue;
  if (params.state) ticketData.State = params.state;
  if (params.priority) ticketData.Priority = params.priority;
  if (params.owner) ticketData.Owner = params.owner;
  if (params.responsible) ticketData.Responsible = params.responsible;
  if (params.lock) ticketData.Lock = params.lock;
  if (params.type) ticketData.Type = params.type;
  if (params.customerUser) ticketData.CustomerUser = params.customerUser;
  if (params.pendingTime) ticketData.PendingTime = params.pendingTime;

  const dynamicFields = params.dynamicFields && params.dynamicFields.length > 0
    ? params.dynamicFields.map((df) => ({ Name: df.name, Value: df.value }))
    : undefined;

  let article: TicketArticle | undefined;
  if (params.articleBody) {
    article = {
      Subject: params.articleSubject || "Update",
      Body: params.articleBody,
      ContentType: params.articleContentType || "text/plain; charset=utf-8",
      CommunicationChannel: params.communicationChannel || "Internal",
      SenderType: params.senderType || "agent",
    };
  }

  return client.ticketUpdate(
    params.ticketId,
    Object.keys(ticketData).length > 0 ? ticketData : undefined,
    article,
    dynamicFields
  );
}

export interface AddNoteParams {
  ticketId: string;
  body: string;
  subject?: string;
  contentType?: string;
}

export async function addNote(client: OtoboClient, params: AddNoteParams) {
  return client.ticketUpdate(
    params.ticketId,
    undefined,
    {
      Subject: params.subject || "Note",
      Body: params.body,
      ContentType: params.contentType || "text/plain; charset=utf-8",
      CommunicationChannel: "Internal",
      SenderType: "agent",
    }
  );
}

// --- Bulk runner ----------------------------------------------------------

export interface BulkSuccess {
  ticket_id: string;
  ticket_number?: string;
}

export interface BulkFailure {
  ticket_id: string;
  error: string;
}

export interface BulkResponse {
  succeeded: BulkSuccess[];
  failed: BulkFailure[];
  summary: {
    total: number;
    succeeded_count: number;
    failed_count: number;
  };
}

const DEFAULT_BULK_CONCURRENCY = 10;

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  async function runner(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        const value = await worker(items[idx], idx);
        results[idx] = { status: "fulfilled", value };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }

  const runners = Array.from(
    { length: Math.min(Math.max(limit, 1), items.length) },
    () => runner()
  );
  await Promise.all(runners);
  return results;
}

export async function runBulk(
  ticketIds: string[],
  worker: (ticketId: string) => Promise<{ TicketID?: string; TicketNumber?: string }>,
  concurrency: number = DEFAULT_BULK_CONCURRENCY
): Promise<BulkResponse> {
  const settled = await runWithConcurrency(ticketIds, concurrency, (id) => worker(id));

  const succeeded: BulkSuccess[] = [];
  const failed: BulkFailure[] = [];

  settled.forEach((result, idx) => {
    const id = ticketIds[idx];
    if (result.status === "fulfilled") {
      succeeded.push({
        ticket_id: result.value.TicketID || id,
        ticket_number: result.value.TicketNumber,
      });
    } else {
      const reason = result.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      failed.push({ ticket_id: id, error: message });
    }
  });

  return {
    succeeded,
    failed,
    summary: {
      total: ticketIds.length,
      succeeded_count: succeeded.length,
      failed_count: failed.length,
    },
  };
}
