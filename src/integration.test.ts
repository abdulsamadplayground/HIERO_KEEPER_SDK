// @hiero/keeper — Integration-style test: round-trip scheduled transaction flow
// Validates: Requirements 12.2 (integration-style test with mocked SDK and Mirror Node)

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TransactionDetail } from "./types.js";

// ---------------------------------------------------------------------------
// Mock @hashgraph/sdk — same pattern as scheduled-tx-helper.test.ts
// ---------------------------------------------------------------------------

const mockReceipt = {
  scheduleId: "0.0.77777",
};

const mockExecuteResponse = {
  getReceipt: vi.fn().mockResolvedValue(mockReceipt),
};

const mockScheduleCreate = {
  setScheduledTransaction: vi.fn().mockReturnThis(),
  setExpirationTime: vi.fn().mockReturnThis(),
  execute: vi.fn().mockResolvedValue(mockExecuteResponse),
};

const mockScheduleInfoResult = {
  scheduleId: "0.0.77777",
  memo: "",
  expirationTime: { seconds: 9999999999 },
};

const mockScheduleInfoQuery = {
  setScheduleId: vi.fn().mockReturnThis(),
  execute: vi.fn().mockResolvedValue(mockScheduleInfoResult),
};

vi.mock("@hashgraph/sdk", () => ({
  Client: {
    forTestnet: vi.fn(() => ({ setOperator: vi.fn() })),
    forMainnet: vi.fn(() => ({ setOperator: vi.fn() })),
    forPreviewnet: vi.fn(() => ({ setOperator: vi.fn() })),
  },
  AccountId: { fromString: vi.fn((s: string) => s) },
  PrivateKey: { fromStringDer: vi.fn((s: string) => s) },
  TransferTransaction: vi.fn(() => ({})),
  ScheduleCreateTransaction: vi.fn(() => mockScheduleCreate),
  ScheduleInfoQuery: vi.fn(() => mockScheduleInfoQuery),
  ScheduleSignTransaction: vi.fn(() => ({
    setScheduleId: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue({ execute: vi.fn() }),
  })),
  Timestamp: {
    fromDate: vi.fn((d: Date) => ({ seconds: Math.floor(d.getTime() / 1000) })),
  },
  ContractExecuteTransaction: vi.fn(() => ({
    setContractId: vi.fn().mockReturnThis(),
    setFunctionParameters: vi.fn().mockReturnThis(),
    setPayableAmount: vi.fn().mockReturnThis(),
  })),
  Hbar: vi.fn((v: number) => ({ _hbar: v })),
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import { KeeperClient } from "./keeper-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleTransaction: TransactionDetail = {
  transaction_id: "0.0.1234-1700000000-000",
  consensus_timestamp: "1700000005.000000000",
  result: "SUCCESS",
  transfers: [
    { account: "0.0.1234", amount: -500 },
    { account: "0.0.5678", amount: 500 },
  ],
  name: "cryptotransfer",
  node: "0.0.3",
};

// ---------------------------------------------------------------------------
// Integration test — Task 13.1
// ---------------------------------------------------------------------------

describe("Integration: round-trip scheduled transaction flow", () => {
  let client: KeeperClient;

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-wire mock responses
    mockExecuteResponse.getReceipt.mockResolvedValue(mockReceipt);
    mockScheduleCreate.execute.mockResolvedValue(mockExecuteResponse);
    mockScheduleInfoQuery.execute.mockResolvedValue(mockScheduleInfoResult);

    client = new KeeperClient({
      network: "testnet",
      operatorId: "0.0.1234",
      operatorKey: "302e020100300506032b657004220420abcdef",
    });
  });

  it("should schedule a transaction, query status, and wait for consensus", async () => {
    // 1. Schedule a TransferTransaction with a 60-second delay
    const { TransferTransaction } = await import("@hashgraph/sdk");
    const tx = new TransferTransaction();
    const scheduleId = await client.scheduleTransaction(tx as unknown as import("@hashgraph/sdk").Transaction, 60);

    // 2. Verify the returned ScheduleId
    expect(String(scheduleId)).toBe("0.0.77777");

    // 3. Query schedule status and verify it returns info
    const info = await client.getScheduleStatus(scheduleId);
    expect(info).toBeDefined();
    expect(info.scheduleId).toBe("0.0.77777");

    // 4. Mock the Mirror Node to return a transaction when polled
    //    We replace the mirrorNodeClient.fetchTransaction to return our sample
    const fetchTxSpy = vi
      .spyOn(client.mirrorNodeClient, "fetchTransaction")
      .mockResolvedValue(sampleTransaction);

    // 5. Call waitForConsensus and verify it returns the transaction detail
    const detail = await client.waitForConsensus(
      "0.0.1234-1700000000-000",
      10_000,
    );

    expect(detail).toEqual(sampleTransaction);
    expect(detail.transaction_id).toBe("0.0.1234-1700000000-000");
    expect(detail.result).toBe("SUCCESS");
    expect(detail.transfers).toHaveLength(2);
    expect(fetchTxSpy).toHaveBeenCalledWith("0.0.1234-1700000000-000");
  });
});
