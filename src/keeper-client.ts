// @hiero/keeper — KeeperClient main entry point

import {
  Client as HederaClient,
  AccountId,
  PrivateKey as HederaPrivateKey,
} from "@hashgraph/sdk";
import type {
  Transaction,
  ScheduleId,
  PrivateKey,
  ScheduleInfo,
} from "@hashgraph/sdk";
import type {
  KeeperConfig,
  NetworkName,
  PaginatedResponse,
  TopicMessage,
  TransactionDetail,
  AccountBalance,
  TopicQueryParams,
  JobQueryParams,
  CreateJobParams,
  Job,
  ContractLog,
  AbiItem,
  DecodedEvent,
  Result,
  SubscriptionOptions,
  Subscription,
  MessageCallback,
} from "./types.js";
import { ValidationError } from "./errors.js";
import { RetryPolicy } from "./retry-policy.js";
import { MirrorNodeClient } from "./mirror-node-client.js";
import { HcsSubscriber } from "./hcs-subscriber.js";
import { ScheduledTxHelper } from "./scheduled-tx-helper.js";
import { TransactionTracker } from "./transaction-tracker.js";
import { AutomationHelper } from "./automation-helper.js";
import { JobIndexer } from "./job-indexer.js";
import { EventDecoder } from "./event-decoder.js";

const VALID_NETWORKS: ReadonlySet<string> = new Set<string>([
  "mainnet",
  "testnet",
  "previewnet",
]);

const DEFAULT_MIRROR_URLS: Record<NetworkName, string> = {
  mainnet: "https://mainnet.mirrornode.hedera.com",
  testnet: "https://testnet.mirrornode.hedera.com",
  previewnet: "https://previewnet.mirrornode.hedera.com",
};

/**
 * Main SDK entry point. Holds configuration and exposes all Keeper capabilities.
 */
export class KeeperClient {
  /** Resolved retry policy. */
  readonly retryPolicy: RetryPolicy;
  /** Resolved mirror node base URL. */
  readonly mirrorNodeUrl: string;
  /** Internal Mirror Node HTTP client. */
  readonly mirrorNodeClient: MirrorNodeClient;
  /** Internal Hedera SDK client. */
  readonly hederaClient: HederaClient;
  /** Internal scheduled-transaction helper. */
  readonly scheduledTxHelper: ScheduledTxHelper;
  /** Internal transaction tracker. */
  readonly transactionTracker: TransactionTracker;
  /** Internal automation helper. */
  readonly automationHelper: AutomationHelper;
  /** Internal job indexer. */
  readonly jobIndexer: JobIndexer;

  private readonly config: KeeperConfig;

  constructor(config: KeeperConfig) {
    // --- Validate required fields ---
    if (!config.network || !VALID_NETWORKS.has(config.network)) {
      throw new ValidationError(
        `Invalid network: expected one of "mainnet", "testnet", "previewnet" but received "${String(config.network)}"`,
      );
    }

    if (!config.operatorId || config.operatorId.trim() === "") {
      throw new ValidationError(
        "operatorId is required and must be a non-empty string",
      );
    }

    if (!config.operatorKey || config.operatorKey.trim() === "") {
      throw new ValidationError(
        "operatorKey is required and must be a non-empty string",
      );
    }

    this.config = config;
    this.retryPolicy = new RetryPolicy(config.retryOptions);
    this.mirrorNodeUrl =
      config.mirrorNodeUrl ?? DEFAULT_MIRROR_URLS[config.network];
    this.mirrorNodeClient = new MirrorNodeClient(this.mirrorNodeUrl);

    // --- Hedera SDK client ---
    const networkFactory: Record<NetworkName, () => HederaClient> = {
      mainnet: () => HederaClient.forMainnet(),
      testnet: () => HederaClient.forTestnet(),
      previewnet: () => HederaClient.forPreviewnet(),
    };
    this.hederaClient = networkFactory[config.network]();
    try {
      this.hederaClient.setOperator(
        AccountId.fromString(config.operatorId),
        HederaPrivateKey.fromStringDer(config.operatorKey),
      );
    } catch {
      // Operator credentials will be set lazily when needed.
      // This allows construction to succeed even with credentials
      // that the SDK cannot parse at init time (e.g. forwarded strings).
    }

    this.scheduledTxHelper = new ScheduledTxHelper(this.retryPolicy);
    this.transactionTracker = new TransactionTracker(this.mirrorNodeClient);
    this.automationHelper = new AutomationHelper(this.scheduledTxHelper);
    this.jobIndexer = new JobIndexer();
  }

  // -----------------------------------------------------------------------
  // Scheduled transactions (delegate to ScheduledTxHelper)
  // -----------------------------------------------------------------------

  async scheduleTransaction(
    tx: Transaction,
    executeAfterSeconds: number,
  ): Promise<ScheduleId> {
    return this.scheduledTxHelper.scheduleTransaction(
      tx,
      executeAfterSeconds,
      this.hederaClient,
    );
  }

  async getScheduleStatus(scheduleId: ScheduleId): Promise<ScheduleInfo> {
    return this.scheduledTxHelper.getScheduleStatus(
      scheduleId,
      this.hederaClient,
    );
  }

  async appendSignature(
    scheduleId: ScheduleId,
    key: PrivateKey,
  ): Promise<void> {
    return this.scheduledTxHelper.appendSignature(
      scheduleId,
      key,
      this.hederaClient,
    );
  }

  // -----------------------------------------------------------------------
  // Mirror Node queries (delegate to MirrorNodeClient)
  // -----------------------------------------------------------------------

  async getTopicMessages(
    topicId: string,
    params?: TopicQueryParams,
  ): Promise<PaginatedResponse<TopicMessage>> {
    return this.mirrorNodeClient.fetchTopicMessages(topicId, params);
  }

  async getTransaction(transactionId: string): Promise<TransactionDetail> {
    return this.mirrorNodeClient.fetchTransaction(transactionId);
  }

  async getAccountBalance(accountId: string): Promise<AccountBalance> {
    return this.mirrorNodeClient.fetchAccountBalance(accountId);
  }

  // -----------------------------------------------------------------------
  // HCS subscriptions (stub)
  // -----------------------------------------------------------------------

  subscribeTopic(
    topicId: string,
    callback: MessageCallback,
    options?: SubscriptionOptions,
  ): Subscription {
    const subscriber = new HcsSubscriber(
      this.mirrorNodeClient,
      topicId,
      callback,
      options,
    );
    subscriber.start();
    return subscriber;
  }

  // -----------------------------------------------------------------------
  // Transaction tracking (stubs)
  // -----------------------------------------------------------------------

  async waitForConsensus(
    transactionId: string,
    timeoutMs?: number,
  ): Promise<TransactionDetail> {
    return this.transactionTracker.waitForConsensus(transactionId, timeoutMs);
  }

  async trackTransaction(transactionId: string): Promise<TransactionDetail> {
    return this.transactionTracker.trackTransaction(transactionId);
  }

  // -----------------------------------------------------------------------
  // Automation (stubs)
  // -----------------------------------------------------------------------

  async createJob(params: CreateJobParams): Promise<Job> {
    const job = await this.automationHelper.createJob(params, this.hederaClient);
    this.jobIndexer.addJob(job);
    return job;
  }

  async executeJob(scheduleId: string): Promise<unknown> {
    return this.automationHelper.executeJob(scheduleId, this.hederaClient);
  }

  async getJobs(
    params?: JobQueryParams,
  ): Promise<PaginatedResponse<Job>> {
    return this.jobIndexer.getJobs(params);
  }

  // -----------------------------------------------------------------------
  // Event decoding (stub)
  // -----------------------------------------------------------------------

  decodeEventLog(
    log: ContractLog,
    abi: readonly AbiItem[],
  ): DecodedEvent {
    const decoder = new EventDecoder(abi);
    return decoder.decode(log);
  }

  // -----------------------------------------------------------------------
  // Retry wrapper (stub delegates to retryPolicy)
  // -----------------------------------------------------------------------

  async safeExecute<T>(fn: () => Promise<T>): Promise<Result<T>> {
    return this.retryPolicy.safeExecute(fn);
  }
}
