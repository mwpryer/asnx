import type { ArgsDef, CommandContext } from "citty";

import { printError, type JsonStream } from "@/output";
import { HTTP_TIMEOUT_MS } from "@/utils";

type CliErrorKind =
  | "usage"
  | "auth"
  | "api"
  | "transport"
  | "config"
  | "internal";

interface CliErrorOptions {
  kind: CliErrorKind;
  message: string;
  status?: number;
  help?: string;
  cause?: unknown;
}

interface ExitWithErrorDependencies {
  stderr?: JsonStream;
  exit?: (code: number) => never;
}

export class CliError extends Error {
  readonly kind: CliErrorKind;
  readonly status?: number;
  readonly help?: string;

  constructor({ kind, message, status, help, cause }: CliErrorOptions) {
    super(message);
    this.name = "CliError";
    this.kind = kind;
    this.status = status;
    this.help = help;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function toCliError(err: unknown): CliError {
  // Normalize thrown values to CLI error
  if (err instanceof CliError) {
    return err;
  }

  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return new CliError({
        kind: "transport",
        message: `Request timed out after ${HTTP_TIMEOUT_MS}ms.`,
        cause: err,
      });
    }

    // Connect timeouts nested under cause
    const cause = (err as { cause?: unknown }).cause;
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "UND_ERR_CONNECT_TIMEOUT"
    ) {
      return new CliError({
        kind: "transport",
        message: "Request connection timed out.",
        cause: err,
      });
    }

    return new CliError({
      kind: "internal",
      message: err.message,
      cause: err,
    });
  }

  return new CliError({
    kind: "internal",
    message: String(err),
  });
}

export function exitWithError(
  err: unknown,
  deps: ExitWithErrorDependencies = {},
): never {
  const error = toCliError(err);
  const stderr = deps.stderr ?? process.stderr;
  const exit = deps.exit ?? process.exit;
  const payload: {
    status: number | null;
    message: string;
    help?: string;
  } = {
    status: error.status ?? null,
    message: error.message,
  };

  if (error.help) {
    payload.help = error.help;
  }

  printError(payload, stderr);

  exit(1);
  throw new Error("unreachable");
}

export function runOrExit<T extends ArgsDef = ArgsDef>(
  run: (context: CommandContext<T>) => unknown | Promise<unknown>,
): (context: CommandContext<T>) => Promise<unknown> {
  return async (context) => {
    try {
      return await run(context);
    } catch (err) {
      exitWithError(err);
    }
  };
}
