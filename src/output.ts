export interface JsonStream {
  write(chunk: string): boolean;
}

interface SuccessMeta {
  status?: number;
  nextPage?: string | null;
  dryRun?: boolean;
}

interface ErrorPayload {
  status: number | null;
  message: string;
  help?: string;
}

function writeJson(stream: JsonStream, value: unknown): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printSuccess(
  command: string,
  data: unknown,
  meta: SuccessMeta = {},
  stdout: JsonStream = process.stdout,
): void {
  writeJson(stdout, { meta: { command, ...meta }, data });
}

export function printError(
  error: ErrorPayload,
  stderr: JsonStream = process.stderr,
): void {
  writeJson(stderr, { error });
}
