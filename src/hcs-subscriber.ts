// @hiero/keeper — HCS topic subscriber with polling, base64 decoding, and checkpointing

import type {
  Checkpoint,
  MessageCallback,
  Subscription,
  SubscriptionOptions,
  TopicQueryParams,
} from "./types.js";
import type { MirrorNodeClient } from "./mirror-node-client.js";

const DEFAULT_POLLING_INTERVAL_MS = 5000;

/** Timer functions injectable for testing. */
export interface TimerFns {
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
}

const defaultTimerFns: TimerFns = {
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
};

/**
 * Decode a base64-encoded string to UTF-8.
 */
export function decodeBase64(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf-8");
}

/**
 * HCS topic subscriber that polls the Mirror Node for new messages,
 * decodes base64 content, invokes a callback, and persists checkpoints.
 */
export class HcsSubscriber implements Subscription {
  readonly topicId: string;
  private _isActive = false;
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _checkpoint: Checkpoint;
  private _polling = false;

  private readonly _mirrorClient: MirrorNodeClient;
  private readonly _callback: MessageCallback;
  private readonly _pollingIntervalMs: number;
  private readonly _onError?: (error: Error) => void;
  private readonly _onCheckpoint?: (checkpoint: Checkpoint) => void;
  private readonly _timer: TimerFns;

  constructor(
    mirrorClient: MirrorNodeClient,
    topicId: string,
    callback: MessageCallback,
    options?: SubscriptionOptions,
    timerFns?: TimerFns,
  ) {
    this._mirrorClient = mirrorClient;
    this.topicId = topicId;
    this._callback = callback;
    this._pollingIntervalMs =
      options?.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;
    this._onError = options?.onError;
    this._onCheckpoint = options?.onCheckpoint;
    this._timer = timerFns ?? defaultTimerFns;

    // Initialize checkpoint from options or create a fresh one
    this._checkpoint = options?.checkpoint
      ? { ...options.checkpoint }
      : { topicId };
  }

  get isActive(): boolean {
    return this._isActive;
  }

  /** Current checkpoint state. */
  get checkpoint(): Checkpoint {
    return { ...this._checkpoint };
  }

  /** Start the polling loop. */
  start(): void {
    if (this._isActive) return;
    this._isActive = true;

    // Do an immediate poll, then set up the interval
    void this._poll();
    this._intervalId = this._timer.setInterval(() => {
      void this._poll();
    }, this._pollingIntervalMs);
  }

  /** Stop polling and release resources. */
  stop(): void {
    this._isActive = false;
    if (this._intervalId !== null) {
      this._timer.clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /** Single poll iteration. */
  private async _poll(): Promise<void> {
    if (!this._isActive || this._polling) return;
    this._polling = true;

    try {
      const params: TopicQueryParams = {};

      // Resume from checkpoint position
      if (this._checkpoint.lastTimestamp) {
        // Use timestamp > last to avoid re-fetching the same message
        params.timestampGte = this._checkpoint.lastTimestamp;
      } else if (this._checkpoint.lastSequenceNumber !== undefined) {
        params.sequenceNumberGte = this._checkpoint.lastSequenceNumber;
      }

      const response = await this._mirrorClient.fetchTopicMessages(
        this.topicId,
        params,
      );

      for (const msg of response.data) {
        if (!this._isActive) break;

        // Skip messages we've already processed (same timestamp as checkpoint)
        if (
          this._checkpoint.lastTimestamp &&
          msg.consensus_timestamp <= this._checkpoint.lastTimestamp
        ) {
          continue;
        }

        // Decode base64 message content in-place
        msg.message = decodeBase64(msg.message);

        // Invoke user callback
        await this._callback(msg);

        // Update checkpoint
        this._checkpoint = {
          topicId: this.topicId,
          lastTimestamp: msg.consensus_timestamp,
          lastSequenceNumber: msg.sequence_number,
        };

        // Persist checkpoint via optional callback
        if (this._onCheckpoint) {
          this._onCheckpoint({ ...this._checkpoint });
        }
      }
    } catch (err) {
      if (this._onError) {
        this._onError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this._polling = false;
    }
  }
}
