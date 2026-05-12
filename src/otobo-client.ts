export interface OtoboConfig {
  baseUrl: string;
  username: string;
  password: string;
  webservice: string;
}

export interface TicketArticle {
  Subject: string;
  Body: string;
  ContentType?: string;
  ArticleTypeID?: number;
  SenderTypeID?: number;
  CommunicationChannelID?: number;
  CommunicationChannel?: string;
  SenderType?: string;
  From?: string;
  Charset?: string;
  MimeType?: string;
}

export interface TicketData {
  Title?: string;
  QueueID?: number;
  Queue?: string;
  StateID?: number;
  State?: string;
  PriorityID?: number;
  Priority?: string;
  CustomerUser?: string;
  OwnerID?: number;
  Owner?: string;
  LockID?: number;
  Lock?: string;
  TypeID?: number;
  Type?: string;
  ServiceID?: number;
  Service?: string;
  SLAID?: number;
  SLA?: string;
  ResponsibleID?: number;
  Responsible?: string;
  PendingTime?: string;
  DynamicField?: Array<{ Name: string; Value: string | string[] }>;
}

export interface TicketSearchFilters {
  Title?: string;
  TicketNumber?: string;
  Queues?: string[];
  QueueIDs?: number[];
  States?: string[];
  StateIDs?: number[];
  Priorities?: string[];
  PriorityIDs?: number[];
  CustomerUserLogin?: string;
  CustomerID?: string;
  OwnerIDs?: number[];
  Types?: string[];
  Locks?: string[];
  SortBy?: string;
  OrderBy?: string;
  Limit?: number;
  TicketCreateTimeNewerDate?: string;
  TicketCreateTimeOlderDate?: string;
  TicketLastChangeTimeNewerDate?: string;
  TicketLastChangeTimeOlderDate?: string;
  // Article / fulltext search filters
  Fulltext?: string;
  MIMEBase_From?: string;
  MIMEBase_To?: string;
  MIMEBase_Cc?: string;
  MIMEBase_Subject?: string;
  MIMEBase_Body?: string;
  ArchiveFlags?: string[];
}

export interface TicketGetOptions {
  AllArticles?: boolean;
  DynamicFields?: boolean;
  Extended?: boolean;
}

export class OtoboClient {
  private config: OtoboConfig;

  constructor(config: OtoboConfig) {
    this.config = config;
  }

  private buildUrl(operation: string): string {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    return `${baseUrl}/otobo/nph-genericinterface.pl/Webservice/${this.config.webservice}/${operation}`;
  }

  private authPayload(): { UserLogin: string; Password: string } {
    return {
      UserLogin: this.config.username,
      Password: this.config.password,
    };
  }

  private async request<T>(operation: string, payload: Record<string, unknown>): Promise<T> {
    const url = this.buildUrl(operation);
    const body = {
      ...this.authPayload(),
      ...payload,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Otobo API error (HTTP ${response.status}): ${text || response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;

    if (data.Error) {
      const err = data.Error as Record<string, unknown>;
      throw new Error(`Otobo API error: ${err.ErrorMessage || err.ErrorCode || JSON.stringify(err)}`);
    }

    return data as T;
  }

  async ticketCreate(
    ticket: TicketData & { Title: string; Queue: string; State: string; Priority: string; CustomerUser: string },
    article: TicketArticle,
    dynamicFields?: Array<{ Name: string; Value: string | string[] }>
  ): Promise<{ TicketID: string; TicketNumber: string; ArticleID: string }> {
    const payload: Record<string, unknown> = {
      Ticket: ticket,
      Article: article,
    };
    if (dynamicFields && dynamicFields.length > 0) {
      payload.DynamicField = dynamicFields;
    }
    return this.request("TicketCreate", payload);
  }

  async ticketGet(
    ticketID: string | number,
    options: TicketGetOptions = {}
  ): Promise<{ Ticket: Record<string, unknown>[] }> {
    const payload: Record<string, unknown> = {
      TicketID: String(ticketID),
    };

    if (options.AllArticles) payload.AllArticles = 1;
    if (options.DynamicFields) payload.DynamicFields = 1;
    if (options.Extended) payload.Extended = 1;

    return this.request("TicketGet", payload);
  }

  async ticketSearch(filters: TicketSearchFilters = {}): Promise<{ TicketID: string[] }> {
    return this.request("TicketSearch", { ...filters });
  }

  async ticketUpdate(
    ticketID: string | number,
    ticket?: TicketData,
    article?: TicketArticle,
    dynamicFields?: Array<{ Name: string; Value: string | string[] }>
  ): Promise<{ TicketID: string; TicketNumber: string; ArticleID?: string }> {
    const payload: Record<string, unknown> = {
      TicketID: String(ticketID),
    };

    if (ticket) payload.Ticket = ticket;
    if (article) payload.Article = article;
    if (dynamicFields && dynamicFields.length > 0) {
      payload.DynamicField = dynamicFields;
    }

    return this.request("TicketUpdate", payload);
  }

  async ticketHistoryGet(
    ticketID: string | number
  ): Promise<{ TicketID: string; HistoryGet: unknown[] }> {
    // TicketGet with Extended returns history data
    const payload: Record<string, unknown> = {
      TicketID: String(ticketID),
      Extended: 1,
      AllArticles: 1,
    };
    return this.request("TicketGet", payload);
  }
}
