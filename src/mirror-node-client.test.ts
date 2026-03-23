// @hiero/keeper — MirrorNodeClient unit tests and property tests

import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { MirrorNodeClient } from "./mirror-node-client.js";
import { MirrorNodeError } from "./errors.js";
import type { TopicMessage, TransactionDetail } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = "https://testnet.mirrornode.hedera.com";

/** Create a mock fetch that returns a JSON response. */
function mockFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

/** Create a mock fetch that returns an error response. */
function mockFetchError(status: number, body: string): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ _status: { messages: [{ message: body }] } }),
    text: async () => body,
  });
}

const sampleMessage: TopicMessage = {
  consensus_timestamp: "1234567890.000000001",
  topic_id: "0.0.100",
  message: btoa("hello"),
  sequence_number: 1,
  running_hash: "abc123",
  payer_account_id: "0.0.2",
};

const sampleTransaction: TransactionDetail = {
  transaction_id: "0.0.2@1234567890.000000000",
  consensus_timestamp: "1234567890.000000001",
  result: "SUCCESS",
  transfers: [{ account: "0.0.2", amount: -100 }, { account: "0.0.3", amount: 100 }],
  name: "CRYPTOTRANSFER",
  node: "0.0.3",
};

// ---------------------------------------------------------------------------
// Unit tests (Task 5.4)
// ---------------------------------------------------------------------------

describe("MirrorNodeClient — fetchTopicMessages", () => {
  it("should fetch topic messages and return paginated response", async () => {
    const fetch = mockFetch({
      messages: [sampleMessage],
      links: { next: "/api/v1/topics/0.0.100/messages?limit=1&timestamp=gt:1234567890.000000001" },
    });
    const client = new MirrorNodeClient(BASE_URL, fetch);

    const result = await client.fetchTopicMessages("0.0.100", { limit: 1 });

    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/topics/0.0.100/messages?limit=1`,
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual(sampleMessage);
    expect(result.links.next).toContain("/api/v1/topics/0.0.100/messages");
  });

  it("should build query string with all params", async () => {
    const fetch = mockFetch({ messages: [], links: { next: null } });
    const client = new MirrorNodeClient(BASE_URL, fetch);

    await client.fetchTopicMessages("0.0.100", {
      limit: 5,
      sequenceNumberGte: 10,
      sequenceNumberLte: 20,
      timestampGte: "1234567890.000000000",
      timestampLte: "1234567899.000000000",
    });

    const calledUrl = fetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=5");
    expect(calledUrl).toContain("sequencenumber=gte:10");
    expect(calledUrl).toContain("sequencenumber=lte:20");
    expect(calledUrl).toContain("timestamp=gte:1234567890.000000000");
    expect(calledUrl).toContain("timestamp=lte:1234567899.000000000");
  });

  it("should handle empty messages", async () => {
    const fetch = mockFetch({ messages: [], links: { next: null } });
    const client = new MirrorNodeClient(BASE_URL, fetch);

    const result = await client.fetchTopicMessages("0.0.100");
    expect(result.data).toEqual([]);
    expect(result.links.next).toBeNull();
  });
});

describe("MirrorNodeClient — fetchTransaction", () => {
  it("should fetch a transaction by ID", async () => {
    const fetch = mockFetch({ transactions: [sampleTransaction] });
    const client = new MirrorNodeClient(BASE_URL, fetch);

    const result = await client.fetchTransaction("0.0.2@1234567890.000000000");

    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/transactions/0.0.2@1234567890.000000000`,
    );
    expect(result.transaction_id).toBe("0.0.2@1234567890.000000000");
    expect(result.result).toBe("SUCCESS");
    expect(result.transfers).toHaveLength(2);
  });

  it("should throw MirrorNodeError when transaction not found (empty array)", async () => {
    const fetch = mockFetch({ transactions: [] });
    const client = new MirrorNodeClient(BASE_URL, fetch);

    await expect(
      client.fetchTransaction("0.0.2@9999999999.000000000"),
    ).rejects.toThrow(MirrorNodeError);
  });
});

describe("MirrorNodeClient — fetchAccountBalance", () => {
  it("should fetch account balance", async () => {
    const fetch = mockFetch({
      balances: [{
        account: "0.0.12345",
        balance: 500_000_000,
        tokens: [{ token_id: "0.0.999", balance: 42 }],
      }],
    });
    const client = new MirrorNodeClient(BASE_URL, fetch);

    const result = await client.fetchAccountBalance("0.0.12345");

    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/balances?account.id=0.0.12345`,
    );
    expect(result.account).toBe("0.0.12345");
    expect(result.balance).toBe(500_000_000);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].token_id).toBe("0.0.999");
  });

  it("should throw MirrorNodeError when account not found (empty array)", async () => {
    const fetch = mockFetch({ balances: [] });
    const client = new MirrorNodeClient(BASE_URL, fetch);

    await expect(
      client.fetchAccountBalance("0.0.99999"),
    ).rejects.toThrow(MirrorNodeError);
  });
});

describe("MirrorNodeClient — fetchNextPage (pagination)", () => {
  it("should follow next link and return data", async () => {
    const nextLink = "/api/v1/topics/0.0.100/messages?limit=1&timestamp=gt:1234567890.000000001";
    const secondMessage: TopicMessage = {
      ...sampleMessage,
      consensus_timestamp: "1234567890.000000002",
      sequence_number: 2,
    };
    const fetch = mockFetch({
      messages: [secondMessage],
      links: { next: null },
    });
    const client = new MirrorNodeClient(BASE_URL, fetch);

    const result = await client.fetchNextPage<TopicMessage>(nextLink);

    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}${nextLink}`);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].sequence_number).toBe(2);
    expect(result.links.next).toBeNull();
  });

  it("should handle next link with null (last page)", async () => {
    const fetch = mockFetch({ messages: [], links: { next: null } });
    const client = new MirrorNodeClient(BASE_URL, fetch);

    const result = await client.fetchNextPage<TopicMessage>(
      "/api/v1/topics/0.0.100/messages?limit=1&timestamp=gt:9999",
    );
    expect(result.data).toEqual([]);
    expect(result.links.next).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// HTTP error mapping (Task 5.3 unit tests)
// ---------------------------------------------------------------------------

describe("MirrorNodeClient — HTTP error mapping", () => {
  it("should throw MirrorNodeError with status 404 on not found", async () => {
    const fetch = mockFetchError(404, "Not Found");
    const client = new MirrorNodeClient(BASE_URL, fetch);

    try {
      await client.fetchTopicMessages("0.0.999");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MirrorNodeError);
      const mnErr = err as MirrorNodeError;
      expect(mnErr.statusCode).toBe(404);
      expect(mnErr.message).toContain("404");
      expect(mnErr.message).toContain("Not Found");
    }
  });

  it("should throw MirrorNodeError with status 500 on server error", async () => {
    const fetch = mockFetchError(500, "Internal Server Error");
    const client = new MirrorNodeClient(BASE_URL, fetch);

    try {
      await client.fetchTransaction("0.0.2@123");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MirrorNodeError);
      const mnErr = err as MirrorNodeError;
      expect(mnErr.statusCode).toBe(500);
      expect(mnErr.message).toContain("500");
      expect(mnErr.message).toContain("Internal Server Error");
    }
  });

  it("should throw MirrorNodeError with status 429 on rate limit", async () => {
    const fetch = mockFetchError(429, "Too Many Requests");
    const client = new MirrorNodeClient(BASE_URL, fetch);

    try {
      await client.fetchAccountBalance("0.0.1");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MirrorNodeError);
      expect((err as MirrorNodeError).statusCode).toBe(429);
    }
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (Task 5.5)
// ---------------------------------------------------------------------------

describe("MirrorNodeClient — Property Tests", () => {
  // Property 4: Mirror Node pagination follows next link
  // **Validates: Requirements 3.2**
  it("Property 4: for any response with a non-null next link, fetchNextPage returns valid data and combined results have no duplicates", async () => {
    // Arbitrary for a sequence number (used as unique ID)
    const seqArb = fc.integer({ min: 1, max: 100_000 });

    // Generate two non-overlapping pages of messages
    const twoPageArb = fc
      .tuple(
        fc.integer({ min: 1, max: 10 }), // page1 size
        fc.integer({ min: 1, max: 10 }), // page2 size
      )
      .chain(([p1Size, p2Size]) => {
        // Generate unique sequence numbers for both pages combined
        return fc
          .uniqueArray(seqArb, { minLength: p1Size + p2Size, maxLength: p1Size + p2Size })
          .map((seqs) => ({
            page1Seqs: seqs.slice(0, p1Size),
            page2Seqs: seqs.slice(p1Size),
          }));
      });

    await fc.assert(
      fc.asyncProperty(twoPageArb, async ({ page1Seqs, page2Seqs }) => {
        const makeMsgs = (seqs: number[]): TopicMessage[] =>
          seqs.map((seq) => ({
            consensus_timestamp: `${seq}.000000000`,
            topic_id: "0.0.100",
            message: btoa(`msg-${seq}`),
            sequence_number: seq,
            running_hash: `hash-${seq}`,
            payer_account_id: "0.0.2",
          }));

        const page1Msgs = makeMsgs(page1Seqs);
        const page2Msgs = makeMsgs(page2Seqs);
        const nextLink = "/api/v1/topics/0.0.100/messages?limit=10&timestamp=gt:next";

        // First call returns page1 with a next link
        // Second call (fetchNextPage) returns page2 with null next
        let callCount = 0;
        const fetch = vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                messages: page1Msgs,
                links: { next: nextLink },
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              messages: page2Msgs,
              links: { next: null },
            }),
          };
        });

        const client = new MirrorNodeClient(BASE_URL, fetch);

        // Fetch page 1
        const result1 = await client.fetchTopicMessages("0.0.100");
        expect(result1.links.next).not.toBeNull();

        // Fetch page 2 via next link
        const result2 = await client.fetchNextPage<TopicMessage>(result1.links.next as string);
        expect(result2.data.length).toBe(page2Seqs.length);

        // Combined results should have no duplicate sequence numbers
        const allSeqs = [...result1.data, ...result2.data].map((m) => m.sequence_number);
        const uniqueSeqs = new Set(allSeqs);
        expect(uniqueSeqs.size).toBe(allSeqs.length);
      }),
      { numRuns: 100 },
    );
  });

  // Property 5: HTTP error mapping
  // **Validates: Requirements 3.5**
  it("Property 5: for any HTTP status code 400-599, the error contains the status code and body text", async () => {
    const statusArb = fc.integer({ min: 400, max: 599 });
    const bodyArb = fc.string({ minLength: 1, maxLength: 200 });

    await fc.assert(
      fc.asyncProperty(statusArb, bodyArb, async (status, body) => {
        const fetch = vi.fn().mockResolvedValue({
          ok: false,
          status,
          text: async () => body,
          json: async () => ({}),
        });

        const client = new MirrorNodeClient(BASE_URL, fetch);

        try {
          await client.fetchTopicMessages("0.0.1");
          expect.unreachable("Should have thrown MirrorNodeError");
        } catch (err) {
          expect(err).toBeInstanceOf(MirrorNodeError);
          const mnErr = err as MirrorNodeError;
          expect(mnErr.statusCode).toBe(status);
          expect(mnErr.message).toContain(String(status));
          expect(mnErr.message).toContain(body);
        }
      }),
      { numRuns: 100 },
    );
  });
});
