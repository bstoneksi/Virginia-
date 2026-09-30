/**
 * HTTP-aware error classes shared by the repo and the route layer.
 * Routes never build error bodies by hand: throw one of these and `app.onError` renders
 * `{ error, details? }` with the right status code (docs/SPEC.md §1).
 */
import type { ApiError } from "../../shared/types";

export type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 500 | 501 | 503;

export class HttpError extends Error {
  readonly status: HttpErrorStatus;
  readonly details: unknown;

  constructor(status: HttpErrorStatus, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }

  toBody(): ApiError {
    return this.details === undefined ? { error: this.message } : { error: this.message, details: this.details };
  }
}

/** 422 — the request was well-formed but the values are not acceptable. */
export class ValidationError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(422, message, details);
    this.name = "ValidationError";
  }
}

/** 404 — unknown id / code. */
export class NotFoundError extends HttpError {
  constructor(message = "Not found", details?: unknown) {
    super(404, message, details);
    this.name = "NotFoundError";
  }
}

/** 409 — the operation conflicts with the current state (duplicate code, proposal already accepted, ...). */
export class ConflictError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(409, message, details);
    this.name = "ConflictError";
  }
}

/** 413 — an uploaded file is too large. */
export class PayloadTooLargeError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(413, message, details);
    this.name = "PayloadTooLargeError";
  }
}

/** 501 — an optional module (importer, AI) is not wired into this process. */
export class NotImplementedError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(501, message, details);
    this.name = "NotImplementedError";
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}
