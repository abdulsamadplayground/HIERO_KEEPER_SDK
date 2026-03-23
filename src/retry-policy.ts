// @hiero/keeper — Retry policy with exponential backoff + full jitter

import type { RetryOptions, Result } from "./types.js";

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_TRANSIENT_CODES: string[] = [
  "BUSY",
  "PLATFORM_TRANSACTION_NOT_CREATED",
];

/**
 * Retry policy implementing exponential backoff with full jitter.
 *
 * Delay for attempt `n` is a random value in `[0, baseDelayMs * 2^n]`.
 */
export class RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly transientCodes: string[];

  private readonly _sleep: (ms: number) => Promise<void>;

  constructor(
    options?: RetryOptions,
    sleepFn?: (ms: number) => Promise<void>,
  ) {
    this.maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.transientCodes = options?.transientCodes ?? [...DEFAULT_TRANSIENT_CODES];
    this._sleep = sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Compute the jittered delay for a given attempt.
   * Returns a random value in `[0, baseDelayMs * 2^attempt]`.
   */
  static computeDelay(attempt: number, baseDelayMs: number): number {
    const ceiling = baseDelayMs * Math.pow(2, attempt);
    return Math.random() * ceiling;
  }

  /**
   * Execute `fn`, retrying on transient errors up to `maxAttempts` times.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;

        if (!this.isTransient(error)) {
          throw error;
        }

        // If this was the last attempt, don't sleep — just fall through
        if (attempt < this.maxAttempts - 1) {
          const delay = RetryPolicy.computeDelay(attempt, this.baseDelayMs);
          await this._sleep(delay);
        }
      }
    }

    throw lastError as Error;
  }

  /**
   * Wrap `fn` with the retry policy and return a `Result<T>`.
   */
  async safeExecute<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      const value = await this.execute(fn);
      return { ok: true, value };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { ok: false, error };
    }
  }

  /**
   * Check whether an error is transient based on its `code` property or message.
   */
  private isTransient(error: Error): boolean {
    const code = (error as Error & { code?: string }).code;
    if (code && this.transientCodes.includes(code)) {
      return true;
    }
    return this.transientCodes.some((tc) => error.message.includes(tc));
  }
}
