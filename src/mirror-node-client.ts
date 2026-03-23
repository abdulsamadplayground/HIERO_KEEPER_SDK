// @hiero/keeper — MirrorNodeClient for Mirror Node REST API

import type {
  TopicMessage,
  TransactionDetail,
  AccountBalance,
  TokenBalance,
  PaginatedResponse,
  TopicQueryParams,
} from "./types.js";
import { MirrorNodeError } from "./errors.js";

/** Minimal fetch signature for dependency injection. */
export type FetchFn = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * HTTP client for the Hedera Mirror Node REST API.
 *
 * Handles URL construction, response typing, pagination link following,
 * and HTTP error mapping to `MirrorNodeError`.
 */
export class MirrorNodeClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;

  constructor(baseUrl: string, fetchFn?: FetchFn) {
    // Strip trailing slash for consistent URL construction
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Fetch topic messages from the Mirror Node.
   */
  async fetchTopicMessages(
    topicId: string,
    params?: TopicQueryParams,
  ): Promise<PaginatedResponse<TopicMessage>> {
    const qs = buildTopicQueryString(params);
    const url = `${this.baseUrl}/api/v1/topics/${topicId}/messages${qs}`;
    const json = await this.request(url);
    return {
      data: json.messages ?? [],
      links: { next: json.links?.next ?? null },
    };
  }

  /**
   * Fetch a single transaction by ID.
   */
  async fetchTransaction(transactionId: string): Promise<TransactionDetail> {
    const url = `${this.baseUrl}/api/v1/transactions/${transactionId}`;
    const json = await this.request(url);
    const tx = json.transactions?.[0];
    if (!tx) {
      throw new MirrorNodeError(404, `Transaction ${transactionId} not found`);
    }
    return tx as TransactionDetail;
  }

  /**
   * Fetch account balance and token associations.
   */
  async fetchAccountBalance(accountId: string): Promise<AccountBalance> {
    const url = `${this.baseUrl}/api/v1/balances?account.id=${accountId}`;
    const json = await this.request(url);
    const entry = json.balances?.[0];
    if (!entry) {
      throw new MirrorNodeError(404, `Account ${accountId} not found`);
    }
    return {
      account: entry.account as string,
      balance: entry.balance as number,
      tokens: (entry.tokens ?? []) as TokenBalance[],
    };
  }

  /**
   * Follow a pagination `next` link returned by a previous response.
   */
  async fetchNextPage<T>(nextLink: string): Promise<PaginatedResponse<T>> {
    // nextLink is a relative path like "/api/v1/topics/0.0.1/messages?limit=10&timestamp=gt:..."
    const url = `${this.baseUrl}${nextLink}`;
    const json = await this.request(url);

    // Determine the data key (messages, transactions, balances)
    const dataKey = Object.keys(json).find((k) => k !== "links") ?? "data";
    return {
      data: (json[dataKey] ?? []) as T[],
      links: { next: json.links?.next ?? null },
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Perform an HTTP GET and return parsed JSON.
   * Maps non-2xx responses to `MirrorNodeError`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async request(url: string): Promise<Record<string, any>> {
    const response = await this.fetchFn(url);

    if (!response.ok) {
      const body = await response.text();
      throw new MirrorNodeError(response.status, body);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await response.json()) as Record<string, any>;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTopicQueryString(params?: TopicQueryParams): string {
  if (!params) return "";

  const parts: string[] = [];

  if (params.limit !== undefined) {
    parts.push(`limit=${params.limit}`);
  }
  if (params.sequenceNumberGte !== undefined) {
    parts.push(`sequencenumber=gte:${params.sequenceNumberGte}`);
  }
  if (params.sequenceNumberLte !== undefined) {
    parts.push(`sequencenumber=lte:${params.sequenceNumberLte}`);
  }
  if (params.timestampGte !== undefined) {
    parts.push(`timestamp=gte:${params.timestampGte}`);
  }
  if (params.timestampLte !== undefined) {
    parts.push(`timestamp=lte:${params.timestampLte}`);
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
