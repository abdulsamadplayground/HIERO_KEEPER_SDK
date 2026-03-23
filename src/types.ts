// @hiero/keeper — Core type definitions

/** Supported Hedera network environments. */
export type NetworkName = "mainnet" | "testnet" | "previewnet";

/** Retry configuration for transient error handling. */
export interface RetryOptions {
  /** Maximum number of retry attempts. @default 5 */
  maxAttempts?: number;
  /** Base delay in milliseconds for exponential backoff. @default 500 */
  baseDelayMs?: number;
  /** Hedera error codes considered transient. @default ["BUSY", "PLATFORM_TRANSACTION_NOT_CREATED"] */
  transientCodes?: string[];
}

/** SDK initialization configuration. */
export interface KeeperConfig {
  network: NetworkName;
  /** Operator account ID, e.g. "0.0.12345". */
  operatorId: string;
  /** DER-encoded operator private key. */
  operatorKey: string;
  /** Optional custom Mirror Node base URL. */
  mirrorNodeUrl?: string;
  retryOptions?: RetryOptions;
}

/** Discriminated union for success/failure results. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

// ---------------------------------------------------------------------------
// Job types
// ---------------------------------------------------------------------------

export type JobStatus = "PENDING" | "EXECUTED" | "EXPIRED" | "FAILED";

export interface Job {
  scheduleId: string;
  targetContractId: string;
  /** Hex-encoded calldata. */
  calldata: string;
  /** ISO-8601 timestamp. */
  scheduledAt: string;
  executeAfterSeconds: number;
  rewardHbar: number;
  status: JobStatus;
}

// ---------------------------------------------------------------------------
// Mirror Node response types
// ---------------------------------------------------------------------------

export interface TopicMessage {
  consensus_timestamp: string;
  topic_id: string;
  /** Base64-encoded message content. */
  message: string;
  sequence_number: number;
  running_hash: string;
  payer_account_id: string;
}

export interface Transfer {
  account: string;
  amount: number;
}

export interface TransactionDetail {
  transaction_id: string;
  consensus_timestamp: string;
  result: string;
  transfers: Transfer[];
  name: string;
  node: string;
}

export interface AccountBalance {
  account: string;
  balance: number;
  tokens: TokenBalance[];
}

export interface TokenBalance {
  token_id: string;
  balance: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  links: { next: string | null };
  totalCount?: number;
  page?: number;
  totalPages?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Contract / Event types
// ---------------------------------------------------------------------------

export interface ContractLog {
  address: string;
  /** Hex-encoded log data. */
  data: string;
  /** Hex-encoded topic hashes. */
  topics: string[];
}

export interface AbiParam {
  name: string;
  type: string;
  indexed?: boolean;
  components?: AbiParam[];
}

export interface AbiItem {
  type: string;
  name?: string;
  inputs?: AbiParam[];
  anonymous?: boolean;
}

export interface DecodedEvent {
  eventName: string;
  args: Record<string, unknown>;
  signature: string;
}

// ---------------------------------------------------------------------------
// HCS Subscription types
// ---------------------------------------------------------------------------

export interface Checkpoint {
  topicId: string;
  lastTimestamp?: string;
  lastSequenceNumber?: number;
}

export type MessageCallback = (message: TopicMessage) => void | Promise<void>;

export interface SubscriptionOptions {
  /** Polling interval in milliseconds. @default 5000 */
  pollingIntervalMs?: number;
  checkpoint?: Checkpoint;
  onError?: (error: Error) => void;
  /** Called after each message is processed with the updated checkpoint. */
  onCheckpoint?: (checkpoint: Checkpoint) => void;
}

export interface Subscription {
  stop(): void;
  readonly topicId: string;
  readonly isActive: boolean;
}

// ---------------------------------------------------------------------------
// Query parameter types
// ---------------------------------------------------------------------------

export interface TopicQueryParams {
  limit?: number;
  sequenceNumberGte?: number;
  sequenceNumberLte?: number;
  timestampGte?: string;
  timestampLte?: string;
}

export interface JobQueryParams {
  limit?: number;
  page?: number;
  status?: JobStatus;
  targetContractId?: string;
  scheduledAfter?: string;
  scheduledBefore?: string;
}

export interface CreateJobParams {
  targetContractId: string;
  calldata: string;
  executeAfterSeconds: number;
  rewardHbar: number;
}
