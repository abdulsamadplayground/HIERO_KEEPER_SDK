// @hiero/keeper — ScheduledTxHelper unit tests and property tests

import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import { KeeperError } from "./errors.js";
import { mapHederaError, ScheduledTxHelper } from "./scheduled-tx-helper.js";
import { RetryPolicy } from "./retry-policy.js";

// ---------------------------------------------------------------------------
// Mock @hashgraph/sdk
// ---------------------------------------------------------------------------

// We mock the entire SDK module so no real network calls are made.
// Each mock class records calls and returns controllable values.

const mockExecuteResponse = {
  getReceipt: vi.fn(),
};

const mockScheduleCreateTransaction = {
  setScheduledTransaction: vi.fn().mockReturnThis(),
  setExpirationTime: vi.fn().mockReturnThis(),
  execute: vi.fn().mockResolvedValue(mockExecuteResponse),
};

const mockScheduleSignTransaction = {
  setScheduleId: vi.fn().mockReturnThis(),
  sign: vi.fn(),
  execute: vi.fn().mockResolvedValue(mockExecuteResponse),
};

const mockScheduleInfoQuery = {
  setScheduleId: vi.fn().mockReturnThis(),
  execute: vi.fn(),
};

vi.mock("@hashgraph/sdk", () => {
  return {
    ScheduleCreateTransaction: vi.fn(() => mockScheduleCreateTransaction),
    ScheduleSignTransaction: vi.fn(() => mockScheduleSignTransaction),
    ScheduleInfoQuery: vi.fn(() => mockScheduleInfoQuery),
    Timestamp: {
      fromDate: vi.fn((d: Date) => ({ seconds: Math.floor(d.getTime() / 1000) })),
    },
    Client: {
      forTestnet: vi.fn(() => ({
        setOperator: vi.fn(),
      })),
      forMainnet: vi.fn(() => ({
        setOperator: vi.fn(),
      })),
      forPreviewnet: vi.fn(() => ({
        setOperator: vi.fn(),
      })),
    },
    AccountId: {
      fromString: vi.fn((s: string) => s),
    },
    PrivateKey: {
      fromStringDer: vi.fn((s: string) => s),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** No-op sleep so retries don't actually wait. */
const noSleep = () => Promise.resolve();

function makeHelper(): ScheduledTxHelper {
  return new ScheduledTxHelper(
    new RetryPolicy({ maxAttempts: 1 }, noSleep),
  );
}

const fakeClient = {} as import("@hashgraph/sdk").Client;
const fakeTx = {} as import("@hashgraph/sdk").Transaction;
const fakeScheduleId = "0.0.9999" as unknown as import("@hashgraph/sdk").ScheduleId;
const fakeKey = {} as import("@hashgraph/sdk").PrivateKey;

// ---------------------------------------------------------------------------
// Unit tests — Task 7.4
// ---------------------------------------------------------------------------

describe("ScheduledTxHelper — scheduleTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a ScheduleCreateTransaction, execute it, and return the scheduleId", async () => {
    const expectedId = "0.0.5555";
    mockExecuteResponse.getReceipt.mockResolvedValue({
      scheduleId: expectedId,
    });

    const helper = makeHelper();
    const result = await helper.scheduleTransaction(fakeTx, 60, fakeClient);

    expect(result).toBe(expectedId);
    expect(mockScheduleCreateTransaction.setScheduledTransaction).toHaveBeenCalledWith(fakeTx);
    expect(mockScheduleCreateTransaction.setExpirationTime).toHaveBeenCalled();
    expect(mockScheduleCreateTransaction.execute).toHaveBeenCalledWith(fakeClient);
    expect(mockExecuteResponse.getReceipt).toHaveBeenCalledWith(fakeClient);
  });

  it("should map Hedera SDK errors to KeeperError", async () => {
    const sdkError = Object.assign(new Error("tx failed"), {
      status: { toString: () => "INSUFFICIENT_PAYER_BALANCE" },
    });
    mockScheduleCreateTransaction.execute.mockRejectedValueOnce(sdkError);

    const helper = makeHelper();
    await expect(helper.scheduleTransaction(fakeTx, 60, fakeClient)).rejects.toThrow(KeeperError);

    try {
      await helper.scheduleTransaction(fakeTx, 60, fakeClient);
    } catch {
      // reset for other tests
    }
    // Restore default
    mockScheduleCreateTransaction.execute.mockResolvedValue(mockExecuteResponse);
  });
});

describe("ScheduledTxHelper — getScheduleStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should query schedule info and return it", async () => {
    const fakeInfo = { scheduleId: fakeScheduleId, memo: "test" };
    mockScheduleInfoQuery.execute.mockResolvedValue(fakeInfo);

    const helper = makeHelper();
    const result = await helper.getScheduleStatus(fakeScheduleId, fakeClient);

    expect(result).toEqual(fakeInfo);
    expect(mockScheduleInfoQuery.setScheduleId).toHaveBeenCalledWith(fakeScheduleId);
    expect(mockScheduleInfoQuery.execute).toHaveBeenCalledWith(fakeClient);
  });

  it("should map errors from ScheduleInfoQuery to KeeperError", async () => {
    const sdkError = Object.assign(new Error("not found"), {
      status: { toString: () => "INVALID_SCHEDULE_ID" },
    });
    mockScheduleInfoQuery.execute.mockRejectedValueOnce(sdkError);

    const helper = makeHelper();
    await expect(helper.getScheduleStatus(fakeScheduleId, fakeClient)).rejects.toThrow(KeeperError);
  });
});

describe("ScheduledTxHelper — appendSignature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should sign and execute a ScheduleSignTransaction", async () => {
    const signedTx = { execute: vi.fn().mockResolvedValue({}) };
    mockScheduleSignTransaction.sign.mockResolvedValue(signedTx);

    const helper = makeHelper();
    await helper.appendSignature(fakeScheduleId, fakeKey, fakeClient);

    expect(mockScheduleSignTransaction.setScheduleId).toHaveBeenCalledWith(fakeScheduleId);
    expect(mockScheduleSignTransaction.sign).toHaveBeenCalledWith(fakeKey);
    expect(signedTx.execute).toHaveBeenCalledWith(fakeClient);
  });

  it("should map errors from ScheduleSignTransaction to KeeperError", async () => {
    const sdkError = Object.assign(new Error("sign failed"), {
      status: { toString: () => "INVALID_SIGNATURE" },
    });
    mockScheduleSignTransaction.sign.mockRejectedValueOnce(sdkError);

    const helper = makeHelper();
    await expect(helper.appendSignature(fakeScheduleId, fakeKey, fakeClient)).rejects.toThrow(KeeperError);
  });
});

// ---------------------------------------------------------------------------
// mapHederaError unit tests — Task 7.3
// ---------------------------------------------------------------------------

describe("mapHederaError", () => {
  it("should extract status code from error with status property", () => {
    const err = Object.assign(new Error("something went wrong"), {
      status: { toString: () => "BUSY" },
    });
    const mapped = mapHederaError(err);
    expect(mapped).toBeInstanceOf(KeeperError);
    expect(mapped.code).toBe("BUSY");
    expect(mapped.message).toBe("something went wrong");
  });

  it("should use HEDERA_ERROR code when no status property", () => {
    const err = new Error("network timeout");
    const mapped = mapHederaError(err);
    expect(mapped).toBeInstanceOf(KeeperError);
    expect(mapped.code).toBe("HEDERA_ERROR");
    expect(mapped.message).toBe("network timeout");
  });

  it("should pass through KeeperError unchanged", () => {
    const original = new KeeperError("CUSTOM", "already mapped");
    const mapped = mapHederaError(original);
    expect(mapped).toBe(original);
  });

  it("should handle non-Error values", () => {
    const mapped = mapHederaError("string error");
    expect(mapped).toBeInstanceOf(KeeperError);
    expect(mapped.code).toBe("HEDERA_ERROR");
    expect(mapped.message).toBe("string error");
  });
});

// ---------------------------------------------------------------------------
// Property-based tests — Task 7.5
// ---------------------------------------------------------------------------

describe("ScheduledTxHelper — Property Tests", () => {
  // Property 3: Hedera error mapping
  // **Validates: Requirements 2.4**
  it("Property 3: for any error code and message, the mapped error contains both", () => {
    const codeArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);
    const messageArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(codeArb, messageArb, (code, message) => {
        // Simulate a Hedera SDK error with a status property
        const err = Object.assign(new Error(message), {
          status: { toString: () => code },
        });

        const mapped = mapHederaError(err);

        expect(mapped).toBeInstanceOf(KeeperError);
        // The mapped error should contain the original code
        expect(mapped.code).toBe(code);
        // The mapped error should contain the original message
        expect(mapped.message).toBe(message);
      }),
      { numRuns: 100 },
    );
  });
});
