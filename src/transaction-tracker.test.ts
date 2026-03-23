// @hiero/keeper — TransactionTracker unit tests

import { describe, it, expect, vi } from "vitest";
import { TransactionTracker } from "./transaction-tracker.js";
import type { MirrorNodeClient } from "./mirror-node-client.js";
import type { TransactionDetail } from "./types.js";
import { MirrorNodeError, TimeoutError, NotFoundError } from "./errors.js";

/** Helper to build a minimal mock MirrorNodeClient. */
function mockMirrorNode(
  fetchTransaction: MirrorNodeClient["fetchTransaction"],
): MirrorNodeClient {
  return { fetchTransaction } as unknown as MirrorNodeClient;
}

/** A no-op sleep that resolves immediately (for fast tests). */
const instantSleep = () => Promise.resolve();

const sampleTx: TransactionDetail = {
  transaction_id: "0.0.1234-1234567890-000",
  consensus_timestamp: "1234567890.000000000",
  result: "SUCCESS",
  transfers: [{ account: "0.0.1234", amount: -100 }],
  name: "cryptotransfer",
  node: "0.0.3",
};

// ---------------------------------------------------------------------------
// waitForConsensus
// ---------------------------------------------------------------------------

describe("TransactionTracker.waitForConsensus", () => {
  it("returns immediately when Mirror Node has the transaction", async () => {
    const fetch = vi.fn().mockResolvedValue(sampleTx);
    const tracker = new TransactionTracker(mockMirrorNode(fetch), instantSleep);

    const result = await tracker.waitForConsensus("0.0.1234-1234567890-000");

    expect(result).toEqual(sampleTx);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("polls until the transaction appears on the second attempt", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new MirrorNodeError(404, "not found"))
      .mockResolvedValueOnce(sampleTx);

    const sleep = vi.fn().mockResolvedValue(undefined);
    const tracker = new TransactionTracker(mockMirrorNode(fetch), sleep);

    const result = await tracker.waitForConsensus(
      "0.0.1234-1234567890-000",
      30_000,
      500,
    );

    expect(result).toEqual(sampleTx);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("throws TimeoutError when transaction never appears", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new MirrorNodeError(404, "not found"));

    // Use a real clock to simulate timeout — set a very short timeout.
    const tracker = new TransactionTracker(mockMirrorNode(fetch), instantSleep);

    await expect(
      tracker.waitForConsensus("0.0.9999-0000000000-000", 0),
    ).rejects.toThrow(TimeoutError);
  });

  it("TimeoutError message contains transaction ID and elapsed time", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new MirrorNodeError(404, "not found"));

    const tracker = new TransactionTracker(mockMirrorNode(fetch), instantSleep);

    try {
      await tracker.waitForConsensus("0.0.9999-0000000000-000", 0);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as TimeoutError).message).toContain("0.0.9999-0000000000-000");
    }
  });

  it("rethrows non-404 MirrorNodeErrors immediately", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new MirrorNodeError(500, "internal error"));

    const tracker = new TransactionTracker(mockMirrorNode(fetch), instantSleep);

    await expect(
      tracker.waitForConsensus("0.0.1234-1234567890-000"),
    ).rejects.toThrow(MirrorNodeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// trackTransaction
// ---------------------------------------------------------------------------

describe("TransactionTracker.trackTransaction", () => {
  it("returns transaction detail when found", async () => {
    const fetch = vi.fn().mockResolvedValue(sampleTx);
    const tracker = new TransactionTracker(mockMirrorNode(fetch), instantSleep);

    const result = await tracker.trackTransaction("0.0.1234-1234567890-000");
    expect(result).toEqual(sampleTx);
  });

  it("throws NotFoundError when transaction does not exist", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new MirrorNodeError(404, "not found"));

    const tracker = new TransactionTracker(mockMirrorNode(fetch), instantSleep);

    await expect(
      tracker.trackTransaction("0.0.9999-0000000000-000"),
    ).rejects.toThrow(NotFoundError);
  });

  it("NotFoundError message contains the transaction ID", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new MirrorNodeError(404, "not found"));

    const tracker = new TransactionTracker(mockMirrorNode(fetch), instantSleep);

    try {
      await tracker.trackTransaction("0.0.9999-0000000000-000");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).message).toContain("0.0.9999-0000000000-000");
    }
  });

  it("rethrows non-404 errors as-is", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new MirrorNodeError(503, "service unavailable"));

    const tracker = new TransactionTracker(mockMirrorNode(fetch), instantSleep);

    await expect(
      tracker.trackTransaction("0.0.1234-1234567890-000"),
    ).rejects.toThrow(MirrorNodeError);
  });
});
