import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";

import {
  addAccount,
  listAccounts,
  readTokenFromStdin,
  removeAccount,
  resolveAccountToken,
  verifyToken,
} from "@/auth";
import { CliError } from "@/errors";

let tmpDir: string;
let accountsDir: string;
let accountsPath: string;

class FakeStdin extends PassThrough {
  isTTY = false;

  setRawMode(_on: boolean): this {
    return this;
  }
}

class FakeStderr extends Writable {
  output = "";

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (err?: Error | null) => void,
  ): void {
    this.output += chunk.toString();
    callback();
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "asnx-"));
  accountsDir = join(tmpDir, "asnx");
  accountsPath = join(accountsDir, "accounts.json");
  process.env.XDG_CONFIG_HOME = tmpDir;
  delete process.env.ASANA_TOKEN;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.ASANA_TOKEN;
});

describe("addAccount", () => {
  test("adds an account", () => {
    addAccount("work", "1/100:test");
    expect(listAccounts()).toEqual(["work"]);
  });

  test("rejects duplicate name", () => {
    addAccount("work", "1/100:test");
    expect(() => addAccount("work", "1/200:test")).toThrow("already exists");
  });

  test("rejects an empty token", () => {
    expect(() => addAccount("work", "")).toThrow("Token is empty");
    expect(listAccounts()).toEqual([]);
  });

  test("wraps account store write failures as config errors", () => {
    mkdirSync(accountsDir, { recursive: true });
    writeFileSync(accountsPath, JSON.stringify([{ name: "work", token: "x" }]));
    chmodSync(accountsPath, 0o400);

    try {
      addAccount("personal", "1/100:test");
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe("Failed to write accounts file.");
      expect(err.help).toContain("Check permissions");
    }
  });
});

describe("listAccounts", () => {
  test("empty when no file", () => {
    expect(listAccounts()).toEqual([]);
  });

  test("invalid json is wrapped as a config error", () => {
    mkdirSync(accountsDir, { recursive: true });
    writeFileSync(accountsPath, "{");
    try {
      listAccounts();
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe("Stored accounts file is invalid.");
      expect(err.help).toContain("auth add");
    }
  });

  test("invalid account shape is wrapped as a config error", () => {
    mkdirSync(accountsDir, { recursive: true });
    writeFileSync(accountsPath, JSON.stringify([{ name: "work" }]));
    try {
      listAccounts();
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe("Stored accounts file is invalid.");
      expect(err.help).toContain("auth add");
    }
  });

  test("unreadable account store is wrapped as a config error", () => {
    mkdirSync(accountsPath, { recursive: true });
    try {
      listAccounts();
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe("Stored accounts file is invalid.");
      expect(err.help).toContain("auth add");
    }
  });

  test("returns names", () => {
    addAccount("work", "1/100:test");
    addAccount("personal", "1/200:test");
    expect(listAccounts()).toEqual(["work", "personal"]);
  });
});

describe("removeAccount", () => {
  test("removes existing account", () => {
    addAccount("work", "1/100:test");
    removeAccount("work");
    expect(listAccounts()).toEqual([]);
  });

  test("throws for missing account", () => {
    expect(() => removeAccount("missing")).toThrow("not found");
  });
});

describe("resolveAccountToken", () => {
  test("--account flag picks named account", () => {
    addAccount("work", "1/100:test");
    addAccount("personal", "1/200:test");
    expect(resolveAccountToken("personal")).toBe("1/200:test");
  });

  test("--account flag throws for missing name", () => {
    expect(() => resolveAccountToken("missing")).toThrow("not found");
  });

  test("ASANA_TOKEN env var used when no flag", () => {
    process.env.ASANA_TOKEN = "1/300:test";
    expect(resolveAccountToken()).toBe("1/300:test");
  });

  test("single stored account used implicitly", () => {
    addAccount("work", "1/100:test");
    expect(resolveAccountToken()).toBe("1/100:test");
  });

  test("throws when no accounts and no env", () => {
    expect(() => resolveAccountToken()).toThrow("No accounts stored");
  });

  test("throws when multiple accounts and no flag", () => {
    addAccount("work", "1/100:test");
    addAccount("personal", "1/200:test");
    expect(() => resolveAccountToken()).toThrow("Multiple accounts");
  });
});

describe("readTokenFromStdin", () => {
  test("reads piped input from an injected stream", async () => {
    const stdin = new FakeStdin();

    const promise = readTokenFromStdin({ stdin });
    stdin.end("1/100:test\n");

    await expect(promise).resolves.toBe("1/100:test");
  });

  test("trims surrounding whitespace from piped input", async () => {
    const stdin = new FakeStdin();

    const promise = readTokenFromStdin({ stdin });
    stdin.end("  1/100:test \r\n");

    await expect(promise).resolves.toBe("1/100:test");
  });

  test("reads hidden TTY input from injected streams", async () => {
    const stdin = new FakeStdin();
    stdin.isTTY = true;
    const stderr = new FakeStderr();

    const promise = readTokenFromStdin({ stdin, stderr });
    stdin.write("ab\u007fcd\n");

    await expect(promise).resolves.toBe("acd");
    expect(stderr.output).toBe("Token: \n");
  });

  test("delegates TTY interruption to an injected handler", async () => {
    const stdin = new FakeStdin();
    stdin.isTTY = true;
    const stderr = new FakeStderr();

    const promise = readTokenFromStdin({
      stdin,
      stderr,
      onInterrupt: () => {
        throw new Error("Interrupted");
      },
    });
    stdin.write("\u0003");

    await expect(promise).rejects.toThrow("Interrupted");
    expect(stderr.output).toBe("Token: \n");
  });
});

describe("verifyToken", () => {
  test("returns the current user from an injected request function", async () => {
    const executeRequest = async () => ({
      status: 200,
      data: { name: "Alice Example", email: "alice@example.com" },
      nextPage: null,
    });

    await expect(
      verifyToken("1/100:test", { executeRequest }),
    ).resolves.toEqual({
      ok: true,
      name: "Alice Example",
      email: "alice@example.com",
    });
  });

  test("returns an error when the token is rejected", async () => {
    const executeRequest = async () => {
      throw new Error("Not Authorized");
    };

    await expect(
      verifyToken("1/100:test", { executeRequest }),
    ).resolves.toEqual({
      ok: false,
      error: "Not Authorized",
    });
  });
});
