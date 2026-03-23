// @hiero/keeper — AutomationHelper unit tests and property tests

import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import { ValidationError } from "./errors.js";
import { AutomationHelper, serializeJob, deserializeJob } from "./automation-helper.js";
import type { CreateJobParams, Job, JobStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Mock @hashgraph/sdk — same pattern as scheduled-tx-helper.test.ts
// ---------------------------------------------------------------------------

const mockExecuteResponse = {
  getReceipt: vi.fn(),
};

const mockScheduleCreateTransaction = {
  setScheduledTransaction: vi.fn().mockReturnThis(),
  setExpirationTime: vi.fn().mockReturnThis(),
  execute: vi.fn().mockResolvedValue(mockExecuteResponse),
};

const mockContractExecuteTransaction = {
  setContractId: vi.fn().mockReturnThis(),
  setFunctionParameters: vi.fn().mockReturnThis(),
  setPayableAmount: vi.fn().mockReturnThis(),
};

const mockScheduleInfoQuery = {
  setScheduleId: vi.fn().mockReturnThis(),
  execute: vi.fn(),
};

vi.mock("@hashgraph/sdk", () => {
  return {
    ContractExecuteTransaction: vi.fn(() => mockContractExecuteTransaction),
    Hbar: vi.fn((v: number) => ({ _hbar: v })),
    ScheduleCreateTransaction: vi.fn(() => mockScheduleCreateTransaction),
    ScheduleSignTransaction: vi.fn(() => ({
      setScheduleId: vi.fn().mockReturnThis(),
      sign: vi.fn(),
    })),
    ScheduleInfoQuery: vi.fn(() => mockScheduleInfoQuery),
    Timestamp: {
      fromDate: vi.fn((d: Date) => ({ seconds: Math.floor(d.getTime() / 1000) })),
    },
    Client: {
      forTestnet: vi.fn(() => ({ setOperator: vi.fn() })),
      forMainnet: vi.fn(() => ({ setOperator: vi.fn() })),
      forPreviewnet: vi.fn(() => ({ setOperator: vi.fn() })),
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

import { ScheduledTxHelper } from "./scheduled-tx-helper.js";
import { RetryPolicy } from "./retry-policy.js";

const noSleep = () => Promise.resolve();

function makeHelper(): AutomationHelper {
  const scheduledTxHelper = new ScheduledTxHelper(
    new RetryPolicy({ maxAttempts: 1 }, noSleep),
  );
  return new AutomationHelper(scheduledTxHelper);
}

const fakeClient = {} as import("@hashgraph/sdk").Client;

// ---------------------------------------------------------------------------
// Unit tests — Task 9.4
// ---------------------------------------------------------------------------

describe("AutomationHelper — createJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteResponse.getReceipt.mockResolvedValue({
      scheduleId: "0.0.7777",
    });
  });

  it("should create a job with valid parameters", async () => {
    const params: CreateJobParams = {
      targetContractId: "0.0.12345",
      calldata: "0xabcdef",
      executeAfterSeconds: 120,
      rewardHbar: 5,
    };

    const helper = makeHelper();
    const job = await helper.createJob(params, fakeClient);

    expect(job.scheduleId).toBe("0.0.7777");
    expect(job.targetContractId).toBe("0.0.12345");
    expect(job.calldata).toBe("0xabcdef");
    expect(job.executeAfterSeconds).toBe(120);
    expect(job.rewardHbar).toBe(5);
    expect(job.status).toBe("PENDING");
    expect(job.scheduledAt).toBeTruthy();
    // Verify SDK calls
    expect(mockContractExecuteTransaction.setContractId).toHaveBeenCalledWith("0.0.12345");
    expect(mockContractExecuteTransaction.setFunctionParameters).toHaveBeenCalled();
    expect(mockContractExecuteTransaction.setPayableAmount).toHaveBeenCalled();
  });

  it("should accept calldata without 0x prefix", async () => {
    const params: CreateJobParams = {
      targetContractId: "0.0.1",
      calldata: "abcdef",
      executeAfterSeconds: 60,
      rewardHbar: 1,
    };

    const helper = makeHelper();
    const job = await helper.createJob(params, fakeClient);
    expect(job.calldata).toBe("abcdef");
    expect(job.status).toBe("PENDING");
  });

  it("should accept empty calldata", async () => {
    const params: CreateJobParams = {
      targetContractId: "0.0.100",
      calldata: "",
      executeAfterSeconds: 10,
      rewardHbar: 0.5,
    };

    const helper = makeHelper();
    const job = await helper.createJob(params, fakeClient);
    expect(job.calldata).toBe("");
  });

  it("should throw ValidationError for invalid contract ID", async () => {
    const params: CreateJobParams = {
      targetContractId: "invalid",
      calldata: "0xaa",
      executeAfterSeconds: 60,
      rewardHbar: 1,
    };

    const helper = makeHelper();
    await expect(helper.createJob(params, fakeClient)).rejects.toThrow(ValidationError);
  });

  it("should throw ValidationError for contract ID missing shard/realm", async () => {
    const params: CreateJobParams = {
      targetContractId: "12345",
      calldata: "0xaa",
      executeAfterSeconds: 60,
      rewardHbar: 1,
    };

    const helper = makeHelper();
    await expect(helper.createJob(params, fakeClient)).rejects.toThrow(ValidationError);
  });

  it("should throw ValidationError for non-hex calldata", async () => {
    const params: CreateJobParams = {
      targetContractId: "0.0.100",
      calldata: "0xZZZZ",
      executeAfterSeconds: 60,
      rewardHbar: 1,
    };

    const helper = makeHelper();
    await expect(helper.createJob(params, fakeClient)).rejects.toThrow(ValidationError);
  });

  it("should throw ValidationError for calldata with spaces", async () => {
    const params: CreateJobParams = {
      targetContractId: "0.0.100",
      calldata: "ab cd",
      executeAfterSeconds: 60,
      rewardHbar: 1,
    };

    const helper = makeHelper();
    await expect(helper.createJob(params, fakeClient)).rejects.toThrow(ValidationError);
  });
});

describe("AutomationHelper — executeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should query schedule status for the given schedule ID", async () => {
    const fakeInfo = { scheduleId: "0.0.9999", memo: "test" };
    mockScheduleInfoQuery.execute.mockResolvedValue(fakeInfo);

    const helper = makeHelper();
    const result = await helper.executeJob("0.0.9999", fakeClient);

    expect(result).toEqual(fakeInfo);
  });
});

// ---------------------------------------------------------------------------
// Serialization unit tests — Task 9.3
// ---------------------------------------------------------------------------

describe("Job serialization", () => {
  const sampleJob: Job = {
    scheduleId: "0.0.1234",
    targetContractId: "0.0.5678",
    calldata: "0xdeadbeef",
    scheduledAt: "2024-01-01T00:00:00.000Z",
    executeAfterSeconds: 300,
    rewardHbar: 10,
    status: "PENDING",
  };

  it("serializeJob produces valid JSON", () => {
    const json = serializeJob(sampleJob);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("deserializeJob recovers the original job", () => {
    const json = serializeJob(sampleJob);
    const recovered = deserializeJob(json);
    expect(recovered).toEqual(sampleJob);
  });

  it("deserializeJob throws on missing fields", () => {
    const partial = JSON.stringify({ scheduleId: "0.0.1" });
    expect(() => deserializeJob(partial)).toThrow(ValidationError);
  });

  it("deserializeJob throws on invalid JSON", () => {
    expect(() => deserializeJob("not json")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Property-based tests — Task 9.5
// ---------------------------------------------------------------------------

// Arbitrary generators

/** Generate a valid contract ID matching 0.0.N */
const arbContractId = fc.nat({ max: 999999999 }).map((n) => `0.0.${n}`);

/** Generate valid hex calldata (with or without 0x prefix) */
const arbHexCalldata = fc.oneof(
  fc.hexaString({ minLength: 0, maxLength: 64 }),
  fc.hexaString({ minLength: 0, maxLength: 64 }).map((h) => `0x${h}`),
);

/** Generate a positive delay in seconds */
const arbDelay = fc.integer({ min: 1, max: 86400 });

/** Generate a positive reward in hbar */
const arbReward = fc.double({ min: 0.001, max: 1000, noNaN: true, noDefaultInfinity: true });

/** Generate valid CreateJobParams */
const arbValidJobParams: fc.Arbitrary<CreateJobParams> = fc.record({
  targetContractId: arbContractId,
  calldata: arbHexCalldata,
  executeAfterSeconds: arbDelay,
  rewardHbar: arbReward,
});

/** Generate an invalid contract ID (does NOT match 0.0.N) */
const arbInvalidContractId = fc.string({ minLength: 1, maxLength: 30 }).filter(
  (s) => !/^0\.0\.\d+$/.test(s),
);

/** Generate invalid hex calldata (contains non-hex chars) */
const arbInvalidCalldata = fc.string({ minLength: 1, maxLength: 30 }).filter(
  (s) => !/^(0x)?[0-9a-fA-F]*$/.test(s),
);

/** Generate a valid JobStatus */
const arbJobStatus: fc.Arbitrary<JobStatus> = fc.constantFrom(
  "PENDING" as const,
  "EXECUTED" as const,
  "EXPIRED" as const,
  "FAILED" as const,
);

/** Generate a valid Job object */
const arbJob: fc.Arbitrary<Job> = fc.record({
  scheduleId: arbContractId,
  targetContractId: arbContractId,
  calldata: arbHexCalldata,
  scheduledAt: fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }).map(
    (d) => d.toISOString(),
  ),
  executeAfterSeconds: arbDelay,
  rewardHbar: arbReward,
  status: arbJobStatus,
});

describe("AutomationHelper — Property Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteResponse.getReceipt.mockResolvedValue({
      scheduleId: "0.0.7777",
    });
  });

  // Property 9: Job fields match creation input
  // **Validates: Requirements 6.2**
  it("Property 9: for any valid CreateJobParams, the returned Job has matching fields and status PENDING", async () => {
    const helper = makeHelper();

    await fc.assert(
      fc.asyncProperty(arbValidJobParams, async (params) => {
        const job = await helper.createJob(params, fakeClient);

        expect(job.targetContractId).toBe(params.targetContractId);
        expect(job.calldata).toBe(params.calldata);
        expect(job.executeAfterSeconds).toBe(params.executeAfterSeconds);
        expect(job.rewardHbar).toBe(params.rewardHbar);
        expect(job.status).toBe("PENDING");
        expect(job.scheduleId).toBeTruthy();
        expect(job.scheduledAt).toBeTruthy();
      }),
      { numRuns: 100 },
    );
  });

  // Property 10: Invalid job parameters rejection
  // **Validates: Requirements 6.4**
  it("Property 10: for any invalid contract ID, createJob throws ValidationError", async () => {
    const helper = makeHelper();

    await fc.assert(
      fc.asyncProperty(arbInvalidContractId, arbHexCalldata, arbDelay, arbReward, async (contractId, calldata, delay, reward) => {
        const params: CreateJobParams = {
          targetContractId: contractId,
          calldata,
          executeAfterSeconds: delay,
          rewardHbar: reward,
        };

        await expect(helper.createJob(params, fakeClient)).rejects.toThrow(ValidationError);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 10: for any invalid calldata, createJob throws ValidationError", async () => {
    const helper = makeHelper();

    await fc.assert(
      fc.asyncProperty(arbContractId, arbInvalidCalldata, arbDelay, arbReward, async (contractId, calldata, delay, reward) => {
        const params: CreateJobParams = {
          targetContractId: contractId,
          calldata,
          executeAfterSeconds: delay,
          rewardHbar: reward,
        };

        await expect(helper.createJob(params, fakeClient)).rejects.toThrow(ValidationError);
      }),
      { numRuns: 100 },
    );
  });

  // Property 20: Job serialization round-trip
  // **Validates: Requirements 12.4**
  it("Property 20: for any valid Job, JSON round-trip produces a deeply equal object", () => {
    fc.assert(
      fc.property(arbJob, (job) => {
        const roundTripped = JSON.parse(JSON.stringify(job));
        expect(roundTripped).toEqual(job);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 20: serializeJob/deserializeJob round-trip", () => {
    fc.assert(
      fc.property(arbJob, (job) => {
        const recovered = deserializeJob(serializeJob(job));
        expect(recovered).toEqual(job);
      }),
      { numRuns: 100 },
    );
  });
});
