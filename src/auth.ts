import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import * as v from "valibot";

import { executeAsanaRequest } from "@/client";
import { CliError, toCliError } from "@/errors";
import type { JsonStream } from "@/output";
import { xdgDir } from "@/utils";

const AccountSchema = v.strictObject({
  name: v.string(),
  token: v.string(),
});
const AccountsSchema = v.array(AccountSchema);
type Account = v.InferOutput<typeof AccountSchema>;

type TokenInput = NodeJS.ReadableStream & {
  isTTY?: boolean;
  setEncoding(encoding: BufferEncoding): TokenInput;
};

type TokenOutput = JsonStream & {
  columns?: number;
};

type TokenInterrupt = () => unknown;

interface ReadTokenDependencies {
  stdin?: TokenInput;
  stderr?: TokenOutput;
  onInterrupt?: TokenInterrupt;
}

interface VerifyTokenDependencies {
  executeRequest?: typeof executeAsanaRequest;
}

function getAccountStorePath(): string {
  return join(xdgDir("config"), "accounts.json");
}

function invalidAccountsError(cause?: unknown): CliError {
  return new CliError({
    kind: "config",
    message: "Stored accounts file is invalid.",
    help: "Remove or fix accounts.json, then run `asx auth add <name>` again.",
    cause,
  });
}

function accountsWriteError(cause: unknown): CliError {
  return new CliError({
    kind: "config",
    message: "Failed to write accounts file.",
    help: "Check permissions for the asx config directory, then run `asx auth add <name>` again.",
    cause,
  });
}

function loadAccounts(): Account[] {
  let raw: string;
  try {
    raw = readFileSync(getAccountStorePath(), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw invalidAccountsError(err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw invalidAccountsError(err);
  }

  const result = v.safeParse(AccountsSchema, parsed);
  if (!result.success) {
    throw invalidAccountsError(result.issues);
  }
  return result.output;
}

function saveAccounts(accounts: Account[]): void {
  try {
    mkdirSync(xdgDir("config"), { recursive: true, mode: 0o700 });
    const path = getAccountStorePath();
    writeFileSync(path, JSON.stringify(accounts, null, 2) + "\n", {
      mode: 0o600,
    });
    // Reapply mode on existing files
    chmodSync(path, 0o600);
  } catch (err) {
    throw accountsWriteError(err);
  }
}

export function resolveAccountToken(accountName?: string): string {
  if (accountName) {
    const accounts = loadAccounts();
    const found = accounts.find((acc) => acc.name === accountName);
    if (!found) {
      throw new CliError({
        kind: "auth",
        message: `Account "${accountName}" not found.`,
      });
    }
    return found.token;
  }

  const envToken = process.env.ASANA_TOKEN;
  if (envToken) {
    return envToken;
  }

  const accounts = loadAccounts();
  if (accounts.length === 0) {
    throw new CliError({
      kind: "auth",
      message: "No accounts stored. Run `asx auth add <name>`.",
    });
  }
  if (accounts.length > 1) {
    const names = accounts.map((acc) => acc.name).join(", ");
    throw new CliError({
      kind: "auth",
      message: `Multiple accounts stored (${names}). Use --account <name>.`,
    });
  }
  return accounts[0]!.token;
}

export function addAccount(name: string, token: string): void {
  const accounts = loadAccounts();
  if (accounts.some((acc) => acc.name === name)) {
    throw new CliError({
      kind: "auth",
      message: `Account "${name}" already exists.`,
    });
  }
  accounts.push({ name, token });
  saveAccounts(accounts);
}

export function listAccounts(): string[] {
  return loadAccounts().map((acc) => acc.name);
}

export function removeAccount(name: string): void {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((acc) => acc.name === name);
  if (idx === -1) {
    throw new CliError({
      kind: "auth",
      message: `Account "${name}" not found.`,
    });
  }
  accounts.splice(idx, 1);
  saveAccounts(accounts);
}

export function readTokenFromStdin(
  deps: ReadTokenDependencies = {},
): Promise<string> {
  const stdin = deps.stdin ?? process.stdin;
  const stderr = deps.stderr ?? process.stderr;
  const onInterrupt = deps.onInterrupt ?? (() => process.exit(1));
  // Prompt on TTY, stay pipe-friendly in automation
  return stdin.isTTY
    ? readTokenFromTty(stdin, stderr, onInterrupt)
    : readTokenFromPipe(stdin);
}

async function readTokenFromPipe(stdin: TokenInput): Promise<string> {
  stdin.setEncoding("utf-8");

  const chunks: string[] = [];
  for await (const chunk of stdin) {
    chunks.push(chunk as string);
  }

  return chunks.join("").replace(/[\r\n]+$/, "");
}

async function readTokenFromTty(
  stdin: TokenInput,
  stderr: TokenOutput,
  onInterrupt: TokenInterrupt,
): Promise<string> {
  // Mute token echo
  const mutedOutput = Object.assign(
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    {
      columns: stderr.columns ?? 80,
      isTTY: true,
    },
  );

  const rl = createInterface({
    historySize: 0,
    input: stdin,
    output: mutedOutput,
    terminal: true,
  });

  let wroteNewline = false;
  const writeTrailingNewline = () => {
    if (wroteNewline) {
      return;
    }
    wroteNewline = true;
    stderr.write("\n");
  };

  // Race prompt against SIGINT rejection
  let onSigint: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    onSigint = () => {
      writeTrailingNewline();
      rl.close();
      try {
        const err = onInterrupt();
        reject(err instanceof Error ? err : new Error("Interrupted"));
      } catch (err) {
        reject(err);
      }
    };
  });

  rl.once("SIGINT", onSigint);
  try {
    stderr.write("Token: ");
    return await Promise.race([rl.question(""), interrupted]);
  } finally {
    writeTrailingNewline();
    rl.off("SIGINT", onSigint);
    rl.close();
  }
}

export async function verifyToken(
  token: string,
  deps: VerifyTokenDependencies = {},
): Promise<{ ok: boolean; name?: string; email?: string; error?: string }> {
  const executeRequest = deps.executeRequest ?? executeAsanaRequest;
  try {
    const response = await executeRequest(
      { method: "GET", path: "/users/me" },
      token,
    );
    const { name, email } = response.data as { name: string; email: string };
    return { ok: true, name, email };
  } catch (err) {
    return { ok: false, error: toCliError(err).message };
  }
}
