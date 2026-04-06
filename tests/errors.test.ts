import { describe, expect, test } from "bun:test";

import { CliError, exitWithError, toCliError } from "@/errors";

describe("toCliError", () => {
  test("keeps CliError instances intact", () => {
    const err = new CliError({
      kind: "api",
      status: 404,
      message: "Not found",
      help: "Check the GID.",
    });

    expect(toCliError(err)).toBe(err);
  });

  test("wraps generic errors as internal errors", () => {
    expect(toCliError(new Error("Boom"))).toMatchObject({
      kind: "internal",
      status: undefined,
      message: "Boom",
      help: undefined,
    });
  });

  test("stringifies non-errors", () => {
    expect(toCliError("Boom")).toMatchObject({
      kind: "internal",
      status: undefined,
      message: "Boom",
      help: undefined,
    });
  });

  test("keeps connect timeouts distinct", () => {
    const err = new TypeError("fetch failed") as TypeError & {
      cause?: { code: string };
    };
    err.cause = { code: "UND_ERR_CONNECT_TIMEOUT" };

    expect(toCliError(err)).toMatchObject({
      kind: "transport",
      message: "Request connection timed out.",
    });
  });

  test("maps timeout errors to transport errors", () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";

    expect(toCliError(err)).toMatchObject({
      kind: "transport",
      message: "Request timed out after 30000ms.",
    });
  });
});

describe("exitWithError", () => {
  test("writes structured json to stderr and exits 1", () => {
    let stderr = "";

    try {
      exitWithError(
        new CliError({
          kind: "config",
          message: "Cached schema is invalid.",
          help: "Run `asx schema update` to rebuild it.",
        }),
        {
          stderr: {
            write(chunk) {
              stderr += chunk;
              return true;
            },
          },
          exit(code) {
            throw new Error(`exit:${code}`);
          },
        },
      );
      expect.unreachable("should exit");
    } catch (err) {
      expect((err as Error).message).toBe("exit:1");
    }

    expect(stderr).toBe(`{
  "error": {
    "status": null,
    "message": "Cached schema is invalid.",
    "help": "Run \`asx schema update\` to rebuild it."
  }
}
`);
  });
});
