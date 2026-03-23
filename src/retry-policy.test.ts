// @hiero/keeper — RetryPolicy unit tests and property tests

import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { RetryPolicy } from "./retry-policy.js";

// Helper: no-op sleep for fast tests
const noSleep = () => Promise.resolve();

// Helper: create an error with a `code` property
function codedError(code: string): Error & { code: string } {
  const err = new Error(code) as Error & { code: string };
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// Unit tests (Task 3.3)
// ---------------------------------------------------------------------------

describe("RetryPolicy", () => {
  it("should use default options when none provided", () => {
    const policy = new RetryPolicy();
    expect(policy.maxAttempts).toBe(5);
    expect(policy.baseDelayMs).toBe(500);
    expect(policy.transientCodes).toEqual([
      "BUSY",
      "PLATFORM_TRANSACTION_NOT_CREATED",
    ]);
  });

  it("should accept custom options", () => {
    const policy = new RetryPolicy({
      maxAttempts: 3,
      baseDelayMs: 100,
      transientCodes: ["CUSTOM"],
    });
    expect(policy.maxAttempts).toBe(3);
    expect(policy.baseDelayMs).toBe(100);
    expect(policy.transientCodes).toEqual(["CUSTOM"]);
  });

  describe("execute — 0 retries (maxAttempts=1)", () => {
    it("should succeed on first try", async () => {
      const policy = new RetryPolicy({ maxAttempts: 1 }, noSleep);
      const result = await policy.execute(() => Promise.resolve(42));
      expect(result).toBe(42);
    });

    it("should throw immediately on transient error with maxAttempts=1", async () => {
      const policy = new RetryPolicy({ maxAttempts: 1 }, noSleep);
      const fn = vi.fn().mockRejectedValue(codedError("BUSY"));
      await expect(policy.execute(fn)).rejects.toThrow("BUSY");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("execute — immediate success", () => {
    it("should return value without retrying", async () => {
      const policy = new RetryPolicy({ maxAttempts: 5 }, noSleep);
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await policy.execute(fn);
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("execute — non-transient error", () => {
    it("should throw immediately without retrying", async () => {
      const policy = new RetryPolicy({ maxAttempts: 5 }, noSleep);
      const fn = vi
        .fn()
        .mockRejectedValue(codedError("INSUFFICIENT_PAYER_BALANCE"));
      await expect(policy.execute(fn)).rejects.toThrow(
        "INSUFFICIENT_PAYER_BALANCE",
      );
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("execute — transient then success", () => {
    it("should retry and eventually succeed", async () => {
      const policy = new RetryPolicy({ maxAttempts: 3 }, noSleep);
      const fn = vi
        .fn()
        .mockRejectedValueOnce(codedError("BUSY"))
        .mockResolvedValue("recovered");
      const result = await policy.execute(fn);
      expect(result).toBe("recovered");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("safeExecute", () => {
    it("should return ok result on success", async () => {
      const policy = new RetryPolicy({ maxAttempts: 1 }, noSleep);
      const result = await policy.safeExecute(() => Promise.resolve(99));
      expect(result).toEqual({ ok: true, value: 99 });
    });

    it("should return error result on failure", async () => {
      const policy = new RetryPolicy({ maxAttempts: 1 }, noSleep);
      const result = await policy.safeExecute(() =>
        Promise.reject(new Error("boom")),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("boom");
      }
    });
  });
});


// ---------------------------------------------------------------------------
// Property-based tests (Task 3.4)
// ---------------------------------------------------------------------------

describe("RetryPolicy — Property Tests", () => {
  // Property 16: Transient retry exhaustion
  // **Validates: Requirements 9.1, 9.3**
  it("Property 16: transient error exhausts exactly maxAttempts calls", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("BUSY", "PLATFORM_TRANSACTION_NOT_CREATED"),
        fc.integer({ min: 1, max: 10 }),
        async (transientCode, maxAttempts) => {
          const policy = new RetryPolicy({ maxAttempts }, noSleep);
          let callCount = 0;
          const fn = async () => {
            callCount++;
            throw codedError(transientCode);
          };

          try {
            await policy.execute(fn);
          } catch {
            // expected
          }

          expect(callCount).toBe(maxAttempts);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 17: Exponential backoff bounds
  // **Validates: Requirements 9.2**
  it("Property 17: computeDelay is within [0, baseDelayMs * 2^attempt]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 5000 }),
        (attempt, baseDelayMs) => {
          const delay = RetryPolicy.computeDelay(attempt, baseDelayMs);
          const ceiling = baseDelayMs * Math.pow(2, attempt);
          expect(delay).toBeGreaterThanOrEqual(0);
          expect(delay).toBeLessThanOrEqual(ceiling);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 18: Non-transient error no retry
  // **Validates: Requirements 9.5**
  it("Property 18: non-transient error causes exactly 1 attempt", async () => {
    const transientCodes = ["BUSY", "PLATFORM_TRANSACTION_NOT_CREATED"];
    // Generate error codes that are NOT in the transient list
    const nonTransientArb = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter((s) => !transientCodes.some((tc) => s.includes(tc)));

    await fc.assert(
      fc.asyncProperty(nonTransientArb, async (errorCode) => {
        const policy = new RetryPolicy({ maxAttempts: 5 }, noSleep);
        let callCount = 0;
        const fn = async () => {
          callCount++;
          throw codedError(errorCode);
        };

        try {
          await policy.execute(fn);
        } catch {
          // expected
        }

        expect(callCount).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  // Property 19: safeExecute result typing
  // **Validates: Requirements 9.6**
  it("Property 19: safeExecute returns ok on success, error on failure", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.record({
            type: fc.constant("success" as const),
            value: fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null)),
          }),
          fc.record({
            type: fc.constant("failure" as const),
            message: fc.string({ minLength: 1 }),
          }),
        ),
        async (scenario) => {
          const policy = new RetryPolicy({ maxAttempts: 1 }, noSleep);

          if (scenario.type === "success") {
            const result = await policy.safeExecute(() =>
              Promise.resolve(scenario.value),
            );
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(result.value).toBe(scenario.value);
            }
          } else {
            const error = new Error(scenario.message);
            const result = await policy.safeExecute(() => Promise.reject(error));
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error).toBe(error);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
