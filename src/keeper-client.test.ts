// @hiero/keeper — KeeperClient unit tests and property tests

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { KeeperClient } from "./keeper-client.js";
import { ValidationError } from "./errors.js";
import type { KeeperConfig, NetworkName } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_NETWORKS: NetworkName[] = ["mainnet", "testnet", "previewnet"];

const DEFAULT_MIRROR_URLS: Record<NetworkName, string> = {
  mainnet: "https://mainnet.mirrornode.hedera.com",
  testnet: "https://testnet.mirrornode.hedera.com",
  previewnet: "https://previewnet.mirrornode.hedera.com",
};

function validConfig(overrides?: Partial<KeeperConfig>): KeeperConfig {
  return {
    network: "testnet",
    operatorId: "0.0.12345",
    operatorKey: "302e020100300506032b657004220420abcdef",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit tests (Task 4.3)
// ---------------------------------------------------------------------------

describe("KeeperClient — constructor", () => {
  it.each(VALID_NETWORKS)(
    "should construct successfully with network=%s",
    (network) => {
      const client = new KeeperClient(validConfig({ network }));
      expect(client).toBeInstanceOf(KeeperClient);
      expect(client.mirrorNodeUrl).toBe(DEFAULT_MIRROR_URLS[network]);
    },
  );

  it("should use custom mirrorNodeUrl when provided", () => {
    const url = "https://custom.mirror.example.com";
    const client = new KeeperClient(
      validConfig({ mirrorNodeUrl: url }),
    );
    expect(client.mirrorNodeUrl).toBe(url);
  });

  it("should create a RetryPolicy with default options", () => {
    const client = new KeeperClient(validConfig());
    expect(client.retryPolicy).toBeDefined();
    expect(client.retryPolicy.maxAttempts).toBe(5);
  });

  it("should pass retryOptions to RetryPolicy", () => {
    const client = new KeeperClient(
      validConfig({ retryOptions: { maxAttempts: 2, baseDelayMs: 100 } }),
    );
    expect(client.retryPolicy.maxAttempts).toBe(2);
    expect(client.retryPolicy.baseDelayMs).toBe(100);
  });

  // --- Invalid config cases ---

  it("should throw ValidationError for invalid network", () => {
    expect(
      () => new KeeperClient(validConfig({ network: "devnet" as NetworkName })),
    ).toThrow(ValidationError);
  });

  it("should reference 'network' in error for invalid network", () => {
    expect(
      () => new KeeperClient(validConfig({ network: "bad" as NetworkName })),
    ).toThrow(/network/i);
  });

  it("should throw ValidationError when operatorId is empty", () => {
    expect(
      () => new KeeperClient(validConfig({ operatorId: "" })),
    ).toThrow(ValidationError);
  });

  it("should reference 'operatorId' in error for missing operatorId", () => {
    expect(
      () => new KeeperClient(validConfig({ operatorId: "" })),
    ).toThrow(/operatorId/);
  });

  it("should throw ValidationError when operatorKey is empty", () => {
    expect(
      () => new KeeperClient(validConfig({ operatorKey: "" })),
    ).toThrow(ValidationError);
  });

  it("should reference 'operatorKey' in error for missing operatorKey", () => {
    expect(
      () => new KeeperClient(validConfig({ operatorKey: "" })),
    ).toThrow(/operatorKey/);
  });

  it("should throw ValidationError when operatorId is whitespace-only", () => {
    expect(
      () => new KeeperClient(validConfig({ operatorId: "   " })),
    ).toThrow(ValidationError);
  });

  it("should throw ValidationError when operatorKey is whitespace-only", () => {
    expect(
      () => new KeeperClient(validConfig({ operatorKey: "  \t " })),
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (Task 4.4)
// ---------------------------------------------------------------------------

// Arbitraries
const networkArb = fc.constantFrom<NetworkName>("mainnet", "testnet", "previewnet");
const nonEmptyStringArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

const validConfigArb: fc.Arbitrary<KeeperConfig> = fc.record({
  network: networkArb,
  operatorId: nonEmptyStringArb,
  operatorKey: nonEmptyStringArb,
});

describe("KeeperClient — Property Tests", () => {
  // Property 1: Valid configuration acceptance
  // **Validates: Requirements 1.1**
  it("Property 1: any valid config constructs without throwing", () => {
    fc.assert(
      fc.property(validConfigArb, (config) => {
        const client = new KeeperClient(config);
        expect(client).toBeInstanceOf(KeeperClient);
        expect(client.mirrorNodeUrl).toBe(DEFAULT_MIRROR_URLS[config.network]);
      }),
      { numRuns: 100 },
    );
  });

  // Property 2: Invalid configuration rejection
  // **Validates: Requirements 1.4**
  it("Property 2: missing or invalid fields throw ValidationError referencing the field", () => {
    // Sub-case A: invalid network
    const invalidNetworkArb = fc
      .string({ minLength: 1 })
      .filter((s) => !["mainnet", "testnet", "previewnet"].includes(s));

    const invalidNetworkConfigArb = fc.record({
      network: invalidNetworkArb as fc.Arbitrary<NetworkName>,
      operatorId: nonEmptyStringArb,
      operatorKey: nonEmptyStringArb,
    });

    // Sub-case B: empty/missing operatorId
    const emptyOperatorIdConfigArb = fc.record({
      network: networkArb,
      operatorId: fc.constantFrom("", " ", "  \t"),
      operatorKey: nonEmptyStringArb,
    });

    // Sub-case C: empty/missing operatorKey
    const emptyOperatorKeyConfigArb = fc.record({
      network: networkArb,
      operatorId: nonEmptyStringArb,
      operatorKey: fc.constantFrom("", " ", "\t "),
    });

    const invalidConfigArb = fc.oneof(
      invalidNetworkConfigArb,
      emptyOperatorIdConfigArb,
      emptyOperatorKeyConfigArb,
    );

    fc.assert(
      fc.property(invalidConfigArb, (config) => {
        try {
          new KeeperClient(config);
          // Should not reach here
          expect.unreachable("Expected ValidationError to be thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const msg = (err as ValidationError).message.toLowerCase();
          // The error message should reference the problematic field
          const isInvalidNetwork = !["mainnet", "testnet", "previewnet"].includes(config.network);
          const isEmptyId = !config.operatorId || config.operatorId.trim() === "";
          const isEmptyKey = !config.operatorKey || config.operatorKey.trim() === "";

          if (isInvalidNetwork) {
            expect(msg).toContain("network");
          } else if (isEmptyId) {
            expect(msg).toContain("operatorid");
          } else if (isEmptyKey) {
            expect(msg).toContain("operatorkey");
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
