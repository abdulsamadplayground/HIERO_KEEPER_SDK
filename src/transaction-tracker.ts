// @hiero/keeper — TransactionTracker for polling consensus status

import type { TransactionDetail } from "./types.js";
import type { MirrorNodeClient } from "./mirror-node-client.js";
import { MirrorNodeError, TimeoutError, NotFoundError } from "./errors.js";

/** Default sleep using setTimeout. */
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A sleep function signature for dependency injection (testing). */
export type SleepFn = (ms: number) => Promise<void>;

/**
 * Polls the Mirror Node for a transaction until it reaches a terminal state
 * or the configured timeout expires.
 */
export class TransactionTracker {
  private readonly mirrorNodeClient: MirrorNodeClient;
  private readonly sleepFn: SleepFn;

  constructor(mirrorNodeClient: MirrorNodeClient, sleepFn?: SleepFn) {
    this.mirrorNodeClient = mirrorNodeClient;
    this.sleepFn = sleepFn ?? defaultSleep;
  }

  /**
   * Poll the Mirror Node until the transaction reaches consensus or timeout.
   *
   * Once the Mirror Node returns a transaction record, it has reached consensus.
   * If the transaction is not yet available (404), we keep polling.
   *
   * @param transactionId - The transaction ID to track.
   * @param timeoutMs - Maximum time to wait in milliseconds (default 30 000).
   * @param pollIntervalMs - Interval between polls in milliseconds (default 2 000).
   * @returns The transaction detail once consensus is reached.
   * @throws {TimeoutError} if the timeout is exceeded before consensus.
   */
  async waitForConsensus(
    transactionId: string,
    timeoutMs = 30_000,
    pollIntervalMs = 2_000,
  ): Promise<TransactionDetail> {
    const start = Date.now();

    while (true) {
      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) {
        throw new TimeoutError(
          `Transaction ${transactionId} did not reach consensus within ${elapsed}ms`,
        );
      }

      try {
        const detail =
          await this.mirrorNodeClient.fetchTransaction(transactionId);
        // Mirror Node returned a record — consensus has been reached.
        return detail;
      } catch (err) {
        if (err instanceof MirrorNodeError && err.statusCode === 404) {
          // Not found yet — wait and retry.
          await this.sleepFn(pollIntervalMs);
          continue;
        }
        // Unexpected error — rethrow.
        throw err;
      }
    }
  }

  /**
   * Single fetch of a transaction from the Mirror Node.
   *
   * @param transactionId - The transaction ID to look up.
   * @returns The transaction detail if found.
   * @throws {NotFoundError} if the transaction does not exist (404).
   */
  async trackTransaction(transactionId: string): Promise<TransactionDetail> {
    try {
      return await this.mirrorNodeClient.fetchTransaction(transactionId);
    } catch (err) {
      if (err instanceof MirrorNodeError && err.statusCode === 404) {
        throw new NotFoundError(`Transaction ${transactionId} not found`);
      }
      throw err;
    }
  }
}
