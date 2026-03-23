// @hiero/keeper — EventDecoder unit tests and property tests

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Interface } from "ethers";
import { EventDecoder } from "./event-decoder.js";
import { KeeperClient } from "./keeper-client.js";
import { EventDecodingError } from "./errors.js";
import type { AbiItem, ContractLog } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers — encode a log from an ABI event + values using ethers
// ---------------------------------------------------------------------------

function encodeLog(
  abiItem: AbiItem,
  values: unknown[],
): { topics: string[]; data: string } {
  const iface = new Interface([abiItem]);
  const eventName = abiItem.name as string;
  const fragment = iface.getEvent(eventName);
  if (!fragment) throw new Error(`Event ${eventName} not found in ABI`);
  const encoded = iface.encodeEventLog(fragment, values);
  return { topics: encoded.topics as string[], data: encoded.data };
}

// ---------------------------------------------------------------------------
// Known ABI fixtures
// ---------------------------------------------------------------------------

const TRANSFER_ABI: AbiItem = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
};

const APPROVAL_ABI: AbiItem = {
  type: "event",
  name: "Approval",
  inputs: [
    { name: "owner", type: "address", indexed: true },
    { name: "spender", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
};

// ---------------------------------------------------------------------------
// 11.3 — Unit tests
// ---------------------------------------------------------------------------

describe("EventDecoder", () => {
  it("decodes a known Transfer event", () => {
    const from = "0x000000000000000000000000000000000000aaaa";
    const to = "0x000000000000000000000000000000000000bbbb";
    const value = BigInt("1000000");

    const { topics, data } = encodeLog(TRANSFER_ABI, [from, to, value]);
    const log: ContractLog = { address: "0x1234", topics, data };

    const decoder = new EventDecoder([TRANSFER_ABI]);
    const result = decoder.decode(log);

    expect(result.eventName).toBe("Transfer");
    expect(String(result.args.from).toLowerCase()).toBe(from.toLowerCase());
    expect(String(result.args.to).toLowerCase()).toBe(to.toLowerCase());
    expect(result.args.value).toBe(value.toString());
    expect(result.signature).toBe("Transfer(address,address,uint256)");
  });

  it("decodes a known Approval event", () => {
    const owner = "0x000000000000000000000000000000000000cccc";
    const spender = "0x000000000000000000000000000000000000dddd";
    const value = BigInt("500");

    const { topics, data } = encodeLog(APPROVAL_ABI, [owner, spender, value]);
    const log: ContractLog = { address: "0x5678", topics, data };

    const decoder = new EventDecoder([APPROVAL_ABI]);
    const result = decoder.decode(log);

    expect(result.eventName).toBe("Approval");
    expect(String(result.args.owner).toLowerCase()).toBe(owner.toLowerCase());
    expect(String(result.args.spender).toLowerCase()).toBe(spender.toLowerCase());
    expect(result.args.value).toBe(value.toString());
    expect(result.signature).toBe("Approval(address,address,uint256)");
  });

  it("throws EventDecodingError for unmatched topic", () => {
    const decoder = new EventDecoder([TRANSFER_ABI]);
    const log: ContractLog = {
      address: "0x1234",
      topics: [
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ],
      data: "0x",
    };

    expect(() => decoder.decode(log)).toThrow(EventDecodingError);
  });

  it("throws EventDecodingError for malformed data", () => {
    // Use the correct Transfer topic but provide truncated data
    const from = "0x000000000000000000000000000000000000aaaa";
    const to = "0x000000000000000000000000000000000000bbbb";
    const { topics } = encodeLog(TRANSFER_ABI, [from, to, BigInt(1)]);

    const log: ContractLog = {
      address: "0x1234",
      topics,
      data: "0xdeadbeef", // wrong length for uint256
    };

    const decoder = new EventDecoder([TRANSFER_ABI]);
    expect(() => decoder.decode(log)).toThrow(EventDecodingError);
  });
});

describe("KeeperClient.decodeEventLog", () => {
  const client = new KeeperClient({
    network: "testnet",
    operatorId: "0.0.1234",
    operatorKey: "302e020100300506032b657004220420" + "aa".repeat(32),
  });

  it("decodes via KeeperClient delegation", () => {
    const from = "0x000000000000000000000000000000000000aaaa";
    const to = "0x000000000000000000000000000000000000bbbb";
    const value = BigInt("42");

    const { topics, data } = encodeLog(TRANSFER_ABI, [from, to, value]);
    const log: ContractLog = { address: "0xabcd", topics, data };

    const result = client.decodeEventLog(log, [TRANSFER_ABI]);
    expect(result.eventName).toBe("Transfer");
    expect(result.args.value).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// 11.4 — Property tests
// ---------------------------------------------------------------------------

// Arbitrary: generate a valid Ethereum address (20 bytes, hex-encoded)
const arbAddress = fc
  .uint8Array({ minLength: 20, maxLength: 20 })
  .map(
    (bytes) =>
      "0x" +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
  );

// Arbitrary: generate a uint256 value
const arbUint256 = fc.bigUintN(256);

/** Build expected args Record from ABI inputs and values. */
function buildExpectedArgs(
  abi: AbiItem,
  values: unknown[],
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const inputs = abi.inputs ?? [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const val = values[i];
    // Match the decoder's BigInt→string conversion
    args[input.name] = typeof val === "bigint" ? val.toString() : val;
  }
  return args;
}

/**
 * We define a set of "basic type" event definitions and matching value generators.
 * For Property 14 we pick one at random, encode, decode, and verify round-trip.
 */
interface EventSpec {
  abi: AbiItem;
  arbValues: fc.Arbitrary<unknown[]>;
  /** Normalise decoded args for comparison. */
  normalise: (args: Record<string, unknown>) => Record<string, unknown>;
}

const eventSpecs: EventSpec[] = [
  {
    // Transfer(address indexed from, address indexed to, uint256 value)
    abi: TRANSFER_ABI,
    arbValues: fc.tuple(arbAddress, arbAddress, arbUint256).map(([f, t, v]) => [f, t, v]),
    normalise: (args) => ({
      from: String(args.from).toLowerCase(),
      to: String(args.to).toLowerCase(),
      value: args.value,
    }),
  },
  {
    // Approval(address indexed owner, address indexed spender, uint256 value)
    abi: APPROVAL_ABI,
    arbValues: fc.tuple(arbAddress, arbAddress, arbUint256).map(([o, s, v]) => [o, s, v]),
    normalise: (args) => ({
      owner: String(args.owner).toLowerCase(),
      spender: String(args.spender).toLowerCase(),
      value: args.value,
    }),
  },
  {
    // FlagSet(bool indexed active, uint256 count)
    abi: {
      type: "event",
      name: "FlagSet",
      inputs: [
        { name: "active", type: "bool", indexed: true },
        { name: "count", type: "uint256", indexed: false },
      ],
    },
    arbValues: fc.tuple(fc.boolean(), arbUint256).map(([a, c]) => [a, c]),
    normalise: (args) => ({
      active: args.active,
      count: args.count,
    }),
  },
];

// Property 14: Event decoding round-trip
// **Validates: Requirements 8.1, 8.2**
describe("Property 14: Event decoding round-trip", () => {
  // Build a single arbitrary that picks an event spec and generates matching values
  const arbEventAndValues = fc
    .integer({ min: 0, max: eventSpecs.length - 1 })
    .chain((specIdx) => {
      const spec = eventSpecs[specIdx];
      return spec.arbValues.map((values) => ({ spec, values }));
    });

  it("encoding then decoding recovers event name and parameter values", () => {
    fc.assert(
      fc.property(arbEventAndValues, ({ spec, values }) => {
        const { topics, data } = encodeLog(spec.abi, values);
        const log: ContractLog = { address: "0x0001", topics, data };

        const decoder = new EventDecoder([spec.abi]);
        const decoded = decoder.decode(log);

        // Event name matches
        expect(decoded.eventName).toBe(spec.abi.name);

        // Parameter values match (after normalisation)
        const normDecoded = spec.normalise(decoded.args);
        const normExpected = spec.normalise(buildExpectedArgs(spec.abi, values));
        expect(normDecoded).toEqual(normExpected);
      }),
      { numRuns: 100 },
    );
  });
});

// Property 15: Unmatched event log error
// **Validates: Requirements 8.3**
describe("Property 15: Unmatched event log error", () => {
  // Generate a random 32-byte topic that won't match Transfer or Approval
  const arbRandomTopic = fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .map(
      (bytes) =>
        "0x" +
        Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
    );

  const knownAbi: AbiItem[] = [TRANSFER_ABI, APPROVAL_ABI];

  // Pre-compute known topic hashes to filter them out
  const knownIface = new Interface(knownAbi);
  const knownTopics = new Set<string>();
  knownIface.forEachEvent((event) => {
    knownTopics.add(event.topicHash.toLowerCase());
  });

  it("logs with non-matching first topic throw EventDecodingError", () => {
    fc.assert(
      fc.property(arbRandomTopic, (topic) => {
        // Skip the rare case where random bytes happen to match a known topic
        fc.pre(!knownTopics.has(topic.toLowerCase()));

        const log: ContractLog = {
          address: "0x0001",
          topics: [topic],
          data: "0x",
        };

        const decoder = new EventDecoder(knownAbi);
        expect(() => decoder.decode(log)).toThrow(EventDecodingError);
      }),
      { numRuns: 100 },
    );
  });
});
