import { describe, expect, test } from "bun:test";

import { executeAsanaRequest, type RequestDependencies } from "@/client";
import { CliError } from "@/errors";

const TOKEN = "1/100:test";

interface CapturedRequest {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

type Handler = (
  capturedRequest: CapturedRequest,
) => Response | Promise<Response>;

function parseRequestBody(
  body: RequestInit["body"] | null | undefined,
): unknown {
  if (typeof body !== "string") {
    return body ?? null;
  }
  return body.length > 0 ? JSON.parse(body) : null;
}

function buildCapturedRequest(
  input: string | URL | Request,
  init?: RequestInit,
): CapturedRequest {
  let url: string;
  if (typeof input === "string") {
    url = input;
  } else if (input instanceof URL) {
    url = input.toString();
  } else {
    url = input.url;
  }

  let method = init?.method?.toString();
  if (!method) {
    method = input instanceof Request ? input.method : "GET";
  }

  return {
    method,
    url,
    headers: new Headers(init?.headers),
    body: parseRequestBody(init?.body),
  };
}

function createRequestHarness(handler: Handler) {
  const calls: CapturedRequest[] = [];
  const sleeps: number[] = [];
  const fetchFn: NonNullable<RequestDependencies["fetchFn"]> = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const capturedRequest = buildCapturedRequest(input, init);
    calls.push(capturedRequest);
    return handler(capturedRequest);
  };
  const sleepFn: NonNullable<RequestDependencies["sleepFn"]> = async (
    ms: number,
  ) => {
    sleeps.push(ms);
  };

  return {
    calls,
    sleeps,
    run: (request: Parameters<typeof executeAsanaRequest>[0]) =>
      executeAsanaRequest(request, TOKEN, { fetchFn, sleepFn }),
  };
}

describe("successful requests", () => {
  test("GET with query params", async () => {
    const harness = createRequestHarness(() =>
      Response.json({ data: { gid: "abc", name: "bugfix" } }),
    );

    const response = await harness.run({
      method: "GET",
      path: "/tasks/abc",
      query: { opt_fields: ["name", "assignee"] },
    });
    const sent = harness.calls.at(-1)!;

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ gid: "abc", name: "bugfix" });
    expect(response.nextPage).toBeNull();
    expect(sent.headers.get("Authorization")).toBe("Bearer 1/100:test");
    expect(sent.url).toContain("opt_fields=name%2Cassignee");
  });

  test("POST with body", async () => {
    const harness = createRequestHarness(() =>
      Response.json(
        { data: { gid: "def", name: "migration" } },
        { status: 201 },
      ),
    );

    const response = await harness.run({
      method: "POST",
      path: "/tasks",
      body: { data: { name: "migration" } },
    });
    const sent = harness.calls.at(-1)!;

    expect(response.status).toBe(201);
    expect(sent.body).toEqual({ data: { name: "migration" } });
    expect(sent.headers.get("Content-Type")).toBe("application/json");
  });

  test("pagination next_page is extracted", async () => {
    const harness = createRequestHarness(() =>
      Response.json({
        data: [{ gid: "abc" }],
        next_page: { offset: "abc123", uri: "/tasks?offset=abc123" },
      }),
    );

    const response = await harness.run({ method: "GET", path: "/tasks" });
    expect(response.nextPage).toBe("abc123");
  });

  test("empty success body does not crash", async () => {
    const harness = createRequestHarness(
      () => new Response(null, { status: 204 }),
    );

    const response = await harness.run({
      method: "DELETE",
      path: "/tasks/abc",
    });
    expect(response.status).toBe(204);
    expect(response.data).toEqual({});
    expect(response.nextPage).toBeNull();
  });
});

describe("error classification", () => {
  test("401 includes auth help", async () => {
    const harness = createRequestHarness(() =>
      Response.json(
        { errors: [{ message: "Not Authorized" }] },
        { status: 401 },
      ),
    );

    try {
      await harness.run({ method: "GET", path: "/users/me" });
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }
      expect(err.kind).toBe("api");
      expect(err.status).toBe(401);
      expect(err.message).toBe("Not Authorized");
      expect(err.help).toContain("auth status");
    }
  });

  test("404 includes not-found help", async () => {
    const harness = createRequestHarness(() =>
      Response.json(
        { errors: [{ message: "task: Unknown object: zzz" }] },
        { status: 404 },
      ),
    );

    try {
      await harness.run({ method: "GET", path: "/tasks/zzz" });
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }
      expect(err.kind).toBe("api");
      expect(err.status).toBe(404);
      expect(err.help).toContain("GID");
    }
  });
});

describe("retries", () => {
  test("429 retries after Retry-After", async () => {
    let attempts = 0;
    const harness = createRequestHarness(() => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({}), {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return Response.json({ data: { gid: "abc" } });
    });

    const response = await harness.run({ method: "GET", path: "/tasks/abc" });
    expect(response.status).toBe(200);
    expect(harness.calls).toHaveLength(2);
    expect(harness.sleeps).toEqual([0]);
  });

  test("final 429 throws classified error", async () => {
    const harness = createRequestHarness(() => {
      return new Response(
        JSON.stringify({ errors: [{ message: "Rate limited" }] }),
        {
          status: 429,
          headers: { "Retry-After": "0" },
        },
      );
    });

    try {
      await harness.run({ method: "GET", path: "/tasks/abc" });
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }
      expect(err.kind).toBe("api");
      expect(err.status).toBe(429);
      expect(err.message).toBe("Rate limited");
    }

    expect(harness.calls).toHaveLength(4);
    expect(harness.sleeps).toEqual([0, 0, 0]);
  });

  test("5xx retries with backoff", async () => {
    let attempts = 0;
    const harness = createRequestHarness(() => {
      attempts++;
      if (attempts <= 2) {
        return Response.json(
          { errors: [{ message: "Internal" }] },
          { status: 500 },
        );
      }
      return Response.json({ data: { ok: true } });
    });

    const response = await harness.run({ method: "GET", path: "/tasks/abc" });
    expect(response.data).toEqual({ ok: true });
    expect(harness.calls).toHaveLength(3);
    expect(harness.sleeps).toEqual([1000, 2000]);
  });

  test("invalid Retry-After falls back to five seconds", async () => {
    let attempts = 0;
    const harness = createRequestHarness(() => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({}), {
          status: 429,
          headers: { "Retry-After": "soon" },
        });
      }
      return Response.json({ data: { gid: "abc" } });
    });

    await harness.run({ method: "GET", path: "/tasks/abc" });
    expect(harness.sleeps).toEqual([5000]);
  });

  test("invalid non-json error body still classifies by status", async () => {
    const harness = createRequestHarness(
      () => new Response("<html>boom</html>", { status: 500 }),
    );

    try {
      await harness.run({ method: "GET", path: "/tasks/abc" });
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }
      expect(err.kind).toBe("api");
      expect(err.status).toBe(500);
      expect(err.message).toBe("HTTP 500");
    }

    expect(harness.calls).toHaveLength(4);
  });

  test("timeout errors are reported clearly", async () => {
    const harness = createRequestHarness(() => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    });

    try {
      await harness.run({ method: "GET", path: "/tasks/abc" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("Request timed out after 30000ms.");
    }
  });

  test("connect timeouts are not mislabeled as the app timeout", async () => {
    const harness = createRequestHarness(() => {
      const err = new TypeError("fetch failed") as TypeError & {
        cause?: { code: string };
      };
      err.cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
      throw err;
    });

    try {
      await harness.run({ method: "GET", path: "/tasks/abc" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("Request connection timed out.");
    }
  });
});
