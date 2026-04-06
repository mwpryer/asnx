import { CliError, toCliError } from "@/errors";
import { buildQueryString, HTTP_TIMEOUT_MS, sleep } from "@/utils";

const BASE_URL = "https://app.asana.com/api/1.0";
const MAX_RETRIES = 3;
const HELP_BY_STATUS: Partial<Record<number, string>> = {
  401: "Check your token with `asx auth status`.",
  403: "You do not have permission for this resource.",
  404: "Resource not found. Check the GID.",
};

interface ApiErrorBody {
  errors?: { message?: string }[];
}

interface ApiResponseBody extends ApiErrorBody {
  data?: unknown;
  next_page?: {
    offset?: string | null;
  };
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
type SleepFn = (ms: number) => Promise<void>;

export interface AsanaRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | string[]>;
  body?: Record<string, unknown>;
}

interface AsanaResponse {
  status: number;
  data: unknown;
  nextPage: string | null;
}

export interface RequestDependencies {
  fetchFn?: FetchFn;
  sleepFn?: SleepFn;
}

function buildRequestUrl(
  path: string,
  query?: Record<string, string | string[]>,
): string {
  if (!query || Object.keys(query).length === 0) {
    return BASE_URL + path;
  }
  return BASE_URL + path + "?" + buildQueryString(query);
}

function apiError(status: number, body: ApiErrorBody): CliError {
  const messages = body.errors?.flatMap((err) => err.message ?? []) ?? [];
  const message = messages.join("; ") || `HTTP ${status}`;
  return new CliError({
    kind: "api",
    status,
    message,
    help: HELP_BY_STATUS[status],
  });
}

function parseRetryAfter(headerValue: string | null): number {
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  // Fallback for missing or bad Retry-After
  return 5000;
}

async function parseApiResponseBody(
  response: Response,
): Promise<ApiResponseBody> {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as ApiResponseBody;
  } catch {
    if (response.ok) {
      throw new CliError({
        kind: "api",
        status: response.status,
        message: `Invalid JSON response from Asana (HTTP ${response.status}).`,
      });
    }
    return {};
  }
}

export async function executeAsanaRequest(
  request: AsanaRequest,
  token: string,
  deps: RequestDependencies = {},
): Promise<AsanaResponse> {
  const fetchFn = deps.fetchFn ?? fetch;
  const sleepFn = deps.sleepFn ?? sleep;
  const url = buildRequestUrl(request.path, request.query);
  const body = request.body ? JSON.stringify(request.body) : undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: request.method,
        headers,
        body,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      throw toCliError(err);
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      // Honor server rate-limit backoff
      await sleepFn(parseRetryAfter(response.headers.get("Retry-After")));
      continue;
    }

    if (response.status >= 500 && attempt < MAX_RETRIES) {
      // Retry transient 5xx, surface 4xx
      await sleepFn(2 ** attempt * 1000);
      continue;
    }

    const responseBody = await parseApiResponseBody(response);

    if (!response.ok) {
      throw apiError(response.status, responseBody);
    }

    return {
      status: response.status,
      // Unwrap Asana envelope, keep pagination in meta
      data: responseBody.data ?? responseBody,
      nextPage: responseBody.next_page?.offset ?? null,
    };
  }

  throw new CliError({
    kind: "internal",
    message: "Request retry loop exited unexpectedly",
  });
}
