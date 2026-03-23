// @hiero/keeper — Scheduled transaction helpers

import {
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  ScheduleInfoQuery,
  Timestamp,
} from "@hashgraph/sdk";
import type {
  Client,
  Transaction,
  ScheduleId,
  PrivateKey,
  ScheduleInfo,
} from "@hashgraph/sdk";
import { KeeperError } from "./errors.js";
import type { RetryPolicy } from "./retry-policy.js";

/**
 * Map an unknown error thrown by the Hedera SDK into a `KeeperError`.
 *
 * If the error carries a `status` property (Hedera `Status` object) the
 * resulting `KeeperError` will contain the status name as its `code` and
 * the original message.  For all other errors the code defaults to
 * `"HEDERA_ERROR"`.
 */
export function mapHederaError(err: unknown): KeeperError {
  if (err instanceof KeeperError) return err;

  const error = err instanceof Error ? err : new Error(String(err));
  const status = (error as Error & { status?: { toString(): string } }).status;

  const code = status ? String(status) : "HEDERA_ERROR";
  const message = error.message || String(err);

  return new KeeperError(code, message);
}

/**
 * Internal helper wrapping `@hashgraph/sdk` scheduled-transaction
 * primitives: `ScheduleCreateTransaction`, `ScheduleSignTransaction`,
 * and `ScheduleInfoQuery`.
 */
export class ScheduledTxHelper {
  constructor(private readonly retryPolicy: RetryPolicy) {}

  /**
   * Create a scheduled transaction wrapping `tx`, set to expire
   * `executeAfterSeconds` from now, and submit it via `client`.
   *
   * Returns the `ScheduleId` from the transaction receipt.
   */
  async scheduleTransaction(
    tx: Transaction,
    executeAfterSeconds: number,
    client: Client,
  ): Promise<ScheduleId> {
    return this.retryPolicy.execute(async () => {
      try {
        const now = Date.now();
        const expirationSeconds = Math.floor(now / 1000) + executeAfterSeconds;
        const expirationNanos = (now % 1000) * 1_000_000;

        const scheduleTx = new ScheduleCreateTransaction()
          .setScheduledTransaction(tx)
          .setExpirationTime(
            Timestamp.fromDate(new Date(expirationSeconds * 1000 + Math.floor(expirationNanos / 1_000_000))),
          );

        const response = await scheduleTx.execute(client);
        const receipt = await response.getReceipt(client);
        return receipt.scheduleId as ScheduleId;
      } catch (err) {
        throw mapHederaError(err);
      }
    });
  }

  /**
   * Query the current status / info of a scheduled transaction.
   */
  async getScheduleStatus(
    scheduleId: ScheduleId,
    client: Client,
  ): Promise<ScheduleInfo> {
    try {
      const query = new ScheduleInfoQuery().setScheduleId(scheduleId);
      return await query.execute(client);
    } catch (err) {
      throw mapHederaError(err);
    }
  }

  /**
   * Append a signature to an existing scheduled transaction.
   */
  async appendSignature(
    scheduleId: ScheduleId,
    key: PrivateKey,
    client: Client,
  ): Promise<void> {
    try {
      const signTx = new ScheduleSignTransaction().setScheduleId(scheduleId);
      const signed = await signTx.sign(key);
      await signed.execute(client);
    } catch (err) {
      throw mapHederaError(err);
    }
  }
}
