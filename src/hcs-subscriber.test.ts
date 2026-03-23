// @hiero/keeper — HcsSubscriber unit tests and property tests

import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { HcsSubscriber, decodeBase64 } from "./hcs-subscriber.js";
import type { TimerFns } from "./hcs-subscriber.js";
import type { MirrorNodeClient } from "./mirror-node-client.js";
import type {
  TopicMessage,
  PaginatedResponse,
  Checkpoint,
  TopicQueryParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(
  seq: number,
  content: string,
  timestamp?: string,
): TopicMessage {
  return {
    consensus_timestamp: timestamp ?? `100000000${seq}.000000000`,
    topic_id: "0.0.100",
    message: Buffer.from(content, "utf-8").toString("base64"),
    sequence_number: seq,
    running_hash: `hash-${seq}`,
    payer_account_id: "0.0.2",
  };
}

function emptyResponse(): PaginatedResponse<TopicMessage> {
  return { data: [], links: { next: null } };
}

function responseWith(
  msgs: TopicMessage[],
): PaginatedResponse<TopicMessage> {
  return { data: msgs, links: { next: null } };
}

/** Create a mock MirrorNodeClient with a controllable fetchTopicMessages. */
function mockMirrorClient(
  fetchFn?: (
    topicId: string,
    params?: TopicQueryParams,
  ) => Promise<PaginatedResponse<TopicMessage>>,
): MirrorNodeClient {
  return {
    fetchTopicMessages:
      fetchFn ??
      vi.fn().mockResolvedValue(emptyResponse()),
  } as unknown as MirrorNodeClient;
}

/** Fake timer that captures callbacks for manual control. */
function fakeTimers(): {
  timer: TimerFns;
  tick: () => Promise<void>;
  callbacks: Array<() => void>;
  cleared: Set<number>;
} {
  const callbacks: Array<() => void> = [];
  const cleared = new Set<number>();
  let nextId = 1;

  const timer: TimerFns = {
    setInterval: (fn: () => void, _ms: number) => {
      const id = nextId++;
      callbacks.push(() => {
        if (!cleared.has(id)) fn();
      });
      return id as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: (id: ReturnType<typeof setInterval>) => {
      cleared.add(id as unknown as number);
    },
  };

  const tick = async () => {
    // Execute all registered interval callbacks
    for (const cb of callbacks) {
      cb();
    }
    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 0));
  };

  return { timer, tick, callbacks, cleared };
}

// ---------------------------------------------------------------------------
// Unit tests (Task 6.4)
// ---------------------------------------------------------------------------

describe("decodeBase64", () => {
  it("should decode ASCII base64 string", () => {
    expect(decodeBase64("aGVsbG8=")).toBe("hello");
  });

  it("should decode multi-byte UTF-8 base64 string (Japanese)", () => {
    const encoded = Buffer.from("こんにちは", "utf-8").toString("base64");
    expect(decodeBase64(encoded)).toBe("こんにちは");
  });

  it("should decode empty string", () => {
    expect(decodeBase64("")).toBe("");
  });

  it("should decode emoji", () => {
    const encoded = Buffer.from("🚀🌍", "utf-8").toString("base64");
    expect(decodeBase64(encoded)).toBe("🚀🌍");
  });
});

describe("HcsSubscriber — polling and callback", () => {
  it("should start polling and invoke callback with decoded messages", async () => {
    const messages = [makeMessage(1, "hello"), makeMessage(2, "world")];
    const fetchFn = vi.fn().mockResolvedValueOnce(responseWith(messages))
      .mockResolvedValue(emptyResponse());
    const client = mockMirrorClient(fetchFn);
    const received: TopicMessage[] = [];
    const { timer } = fakeTimers();

    const sub = new HcsSubscriber(
      client,
      "0.0.100",
      (msg) => { received.push({ ...msg }); },
      { pollingIntervalMs: 1000 },
      timer,
    );

    sub.start();
    // Wait for the immediate poll to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(sub.isActive).toBe(true);
    expect(received).toHaveLength(2);
    expect(received[0].message).toBe("hello");
    expect(received[1].message).toBe("world");

    sub.stop();
  });

  it("should not start twice if already active", async () => {
    const fetchFn = vi.fn().mockResolvedValue(emptyResponse());
    const client = mockMirrorClient(fetchFn);
    const { timer } = fakeTimers();

    const sub = new HcsSubscriber(
      client,
      "0.0.100",
      () => {},
      { pollingIntervalMs: 1000 },
      timer,
    );

    sub.start();
    sub.start(); // second call should be no-op
    await new Promise((r) => setTimeout(r, 10));

    // Only one immediate poll should have happened
    expect(fetchFn).toHaveBeenCalledTimes(1);
    sub.stop();
  });
});

describe("HcsSubscriber — checkpoint persistence", () => {
  it("should update checkpoint after each message and call onCheckpoint", async () => {
    const messages = [
      makeMessage(1, "a", "1000000001.000000000"),
      makeMessage(2, "b", "1000000002.000000000"),
    ];
    const fetchFn = vi.fn().mockResolvedValueOnce(responseWith(messages))
      .mockResolvedValue(emptyResponse());
    const client = mockMirrorClient(fetchFn);
    const checkpoints: Checkpoint[] = [];
    const { timer } = fakeTimers();

    const sub = new HcsSubscriber(
      client,
      "0.0.100",
      () => {},
      {
        pollingIntervalMs: 1000,
        onCheckpoint: (cp) => checkpoints.push(cp),
      },
      timer,
    );

    sub.start();
    await new Promise((r) => setTimeout(r, 10));

    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].lastTimestamp).toBe("1000000001.000000000");
    expect(checkpoints[0].lastSequenceNumber).toBe(1);
    expect(checkpoints[1].lastTimestamp).toBe("1000000002.000000000");
    expect(checkpoints[1].lastSequenceNumber).toBe(2);

    // The subscriber's checkpoint should reflect the last message
    expect(sub.checkpoint.lastTimestamp).toBe("1000000002.000000000");
    expect(sub.checkpoint.lastSequenceNumber).toBe(2);

    sub.stop();
  });

  it("should resume from checkpoint position on start", async () => {
    const capturedParams: TopicQueryParams[] = [];
    const fetchFn = vi.fn().mockImplementation(
      async (_topicId: string, params?: TopicQueryParams) => {
        if (params) capturedParams.push(params);
        return emptyResponse();
      },
    );
    const client = mockMirrorClient(fetchFn);
    const { timer } = fakeTimers();

    const checkpoint: Checkpoint = {
      topicId: "0.0.100",
      lastTimestamp: "1000000005.000000000",
      lastSequenceNumber: 5,
    };

    const sub = new HcsSubscriber(
      client,
      "0.0.100",
      () => {},
      { pollingIntervalMs: 1000, checkpoint },
      timer,
    );

    sub.start();
    await new Promise((r) => setTimeout(r, 10));

    expect(capturedParams.length).toBeGreaterThanOrEqual(1);
    expect(capturedParams[0].timestampGte).toBe("1000000005.000000000");

    sub.stop();
  });
});

describe("HcsSubscriber — stop()", () => {
  it("should set isActive to false and stop polling", async () => {
    const fetchFn = vi.fn().mockResolvedValue(emptyResponse());
    const client = mockMirrorClient(fetchFn);
    const { timer, cleared } = fakeTimers();

    const sub = new HcsSubscriber(
      client,
      "0.0.100",
      () => {},
      { pollingIntervalMs: 1000 },
      timer,
    );

    sub.start();
    expect(sub.isActive).toBe(true);

    sub.stop();
    expect(sub.isActive).toBe(false);
    expect(cleared.size).toBe(1);
  });

  it("should not invoke callback after stop", async () => {
    let pollCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      pollCount++;
      if (pollCount === 1) {
        return responseWith([makeMessage(1, "first")]);
      }
      return responseWith([makeMessage(2, "second")]);
    });
    const client = mockMirrorClient(fetchFn);
    const received: string[] = [];
    const { timer, tick } = fakeTimers();

    const sub = new HcsSubscriber(
      client,
      "0.0.100",
      (msg) => { received.push(msg.message); },
      { pollingIntervalMs: 100 },
      timer,
    );

    sub.start();
    await new Promise((r) => setTimeout(r, 10));

    // First poll should have delivered "first"
    expect(received).toContain("first");

    sub.stop();

    // Trigger another tick — should not deliver anything
    await tick();
    await new Promise((r) => setTimeout(r, 10));

    expect(received).not.toContain("second");
  });
});

describe("HcsSubscriber — error handling", () => {
  it("should call onError when fetch fails", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const client = mockMirrorClient(fetchFn);
    const errors: Error[] = [];
    const { timer } = fakeTimers();

    const sub = new HcsSubscriber(
      client,
      "0.0.100",
      () => {},
      {
        pollingIntervalMs: 1000,
        onError: (err) => errors.push(err),
      },
      timer,
    );

    sub.start();
    await new Promise((r) => setTimeout(r, 10));

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("network down");

    sub.stop();
  });
});


// ---------------------------------------------------------------------------
// Property-based tests (Task 6.5)
// ---------------------------------------------------------------------------

describe("HcsSubscriber — Property Tests", () => {
  // Property 6: Base64 message decoding round-trip
  // **Validates: Requirements 4.3**
  it("Property 6: for any valid UTF-8 string, base64 encode then decode produces the original", () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (original) => {
        const encoded = Buffer.from(original, "utf-8").toString("base64");
        const decoded = decodeBase64(encoded);
        expect(decoded).toBe(original);
      }),
      { numRuns: 100 },
    );
  });

  // Property 7: Checkpoint round-trip
  // **Validates: Requirements 4.4, 4.5**
  it("Property 7: after processing messages, checkpoint reflects last message and new subscription queries from that position", async () => {
    // Arbitrary for a non-empty sequence of messages with increasing timestamps
    const messagesArb = fc
      .array(
        fc.record({
          seq: fc.integer({ min: 1, max: 100_000 }),
          content: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        { minLength: 1, maxLength: 20 },
      )
      .map((items) =>
        items.map((item, i) => ({
          seq: i + 1,
          content: item.content,
          timestamp: `${1000000000 + i + 1}.000000000`,
        })),
      );

    await fc.assert(
      fc.asyncProperty(messagesArb, async (msgSpecs) => {
        const topicMessages: TopicMessage[] = msgSpecs.map((spec) =>
          makeMessage(spec.seq, spec.content, spec.timestamp),
        );

        let pollCount = 0;
        const capturedParams: TopicQueryParams[] = [];

        const fetchFn = vi.fn().mockImplementation(
          async (_topicId: string, params?: TopicQueryParams) => {
            pollCount++;
            if (params) capturedParams.push({ ...params });
            if (pollCount === 1) {
              return responseWith(topicMessages);
            }
            return emptyResponse();
          },
        );

        const client = mockMirrorClient(fetchFn);
        const checkpoints: Checkpoint[] = [];
        const { timer } = fakeTimers();

        // First subscription — process all messages
        const sub1 = new HcsSubscriber(
          client,
          "0.0.100",
          () => {},
          {
            pollingIntervalMs: 60000,
            onCheckpoint: (cp) => checkpoints.push(cp),
          },
          timer,
        );

        sub1.start();
        await new Promise((r) => setTimeout(r, 10));
        sub1.stop();

        // Checkpoint should reflect the last message
        const lastMsg = msgSpecs[msgSpecs.length - 1];
        expect(checkpoints.length).toBe(msgSpecs.length);
        expect(checkpoints[checkpoints.length - 1].lastTimestamp).toBe(
          lastMsg.timestamp,
        );
        expect(checkpoints[checkpoints.length - 1].lastSequenceNumber).toBe(
          lastMsg.seq,
        );

        // Second subscription with the checkpoint — should query from that position
        pollCount = 0;
        capturedParams.length = 0;

        const sub2 = new HcsSubscriber(
          client,
          "0.0.100",
          () => {},
          {
            pollingIntervalMs: 60000,
            checkpoint: checkpoints[checkpoints.length - 1],
          },
          timer,
        );

        sub2.start();
        await new Promise((r) => setTimeout(r, 10));
        sub2.stop();

        // The second subscription should have queried with timestampGte
        expect(capturedParams.length).toBeGreaterThanOrEqual(1);
        expect(capturedParams[0].timestampGte).toBe(lastMsg.timestamp);
      }),
      { numRuns: 100 },
    );
  });

  // Property 8: Subscription stop
  // **Validates: Requirements 4.6**
  it("Property 8: for any active subscription, calling stop() sets isActive to false", async () => {
    const topicIdArb = fc.tuple(
      fc.constant("0.0."),
      fc.integer({ min: 1, max: 999_999 }),
    ).map(([prefix, id]) => `${prefix}${id}`);

    await fc.assert(
      fc.asyncProperty(topicIdArb, async (topicId) => {
        const fetchFn = vi.fn().mockResolvedValue(emptyResponse());
        const client = mockMirrorClient(fetchFn);
        const { timer } = fakeTimers();

        const sub = new HcsSubscriber(
          client,
          topicId,
          () => {},
          { pollingIntervalMs: 60000 },
          timer,
        );

        sub.start();
        expect(sub.isActive).toBe(true);
        expect(sub.topicId).toBe(topicId);

        sub.stop();
        expect(sub.isActive).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
