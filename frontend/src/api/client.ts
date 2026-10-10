import createClient from "openapi-fetch";

import { S } from "@/strings.zh";

import type { components, paths } from "./schema.gen";

export type Schemas = components["schemas"];

/**
 * Every failed request, as one type. `code` is the backend's stable reason code
 * (see `.trellis/spec/backend/error-handling.md`); branch on it, show `message`.
 * Two codes are produced here and never by the backend: `NETWORK_ERROR` (no response)
 * and `UNEXPECTED_RESPONSE` (a non-2xx body that is not the error envelope, for
 * example a proxy's 502 page).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isEnvelope(value: unknown): value is Schemas["ErrorEnvelope"] {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

/** Resolves to the 2xx body, or throws `ApiError`. All API calls go through this. */
export async function unwrap<T>(request: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await request;
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", S.errors.network);
  }
  const { data, error, response } = result;
  if (response.ok) return data as T;
  if (isEnvelope(error)) {
    throw new ApiError(
      response.status,
      error.code,
      error.message,
      isRecord(error.details) ? error.details : {},
    );
  }
  // The dev proxy and nginx answer 502/504 without an envelope when the backend is down.
  const unreachable = response.status === 502 || response.status === 503 || response.status === 504;
  throw new ApiError(
    response.status,
    unreachable ? "NETWORK_ERROR" : "UNEXPECTED_RESPONSE",
    unreachable ? S.errors.network : S.errors.unexpected,
  );
}

export function createApi(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
  return createClient<paths>({
    // Same origin, so the HttpOnly session cookie is sent (Vite proxy in dev, nginx in prod).
    baseUrl: options.baseUrl ?? globalThis.location?.origin ?? "",
    credentials: "same-origin",
    fetch: options.fetch,
  });
}

export const api = createApi();

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

/** The message to show for any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : S.errors.unexpected;
}
