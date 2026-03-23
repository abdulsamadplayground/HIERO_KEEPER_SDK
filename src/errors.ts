// @hiero/keeper — Error classes

/** Base error class for all SDK errors. */
export class KeeperError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KeeperError";
  }
}

/** Thrown when the Mirror Node REST API returns an HTTP error. */
export class MirrorNodeError extends KeeperError {
  constructor(
    public readonly statusCode: number,
    body: string,
  ) {
    super("MIRROR_NODE_ERROR", `Mirror Node ${statusCode}: ${body}`);
    this.name = "MirrorNodeError";
  }
}

/** Thrown when a contract event log cannot be decoded against the provided ABI. */
export class EventDecodingError extends KeeperError {
  constructor(message: string) {
    super("EVENT_DECODING_ERROR", message);
    this.name = "EventDecodingError";
  }
}

/** Thrown when an operation exceeds its configured timeout. */
export class TimeoutError extends KeeperError {
  constructor(message: string) {
    super("TIMEOUT_ERROR", message);
    this.name = "TimeoutError";
  }
}

/** Thrown when a requested resource (e.g. transaction) is not found. */
export class NotFoundError extends KeeperError {
  constructor(message: string) {
    super("NOT_FOUND_ERROR", message);
    this.name = "NotFoundError";
  }
}

/** Thrown when input validation fails before a network call. */
export class ValidationError extends KeeperError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "ValidationError";
  }
}
