import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { CompiledSchema, EndpointSpec } from "@/compiler";

const projectRoot = resolve(import.meta.dir, "..");
let tmpDir: string;

function writeCompiledSchema(schema: CompiledSchema): void {
  const cacheDir = join(tmpDir, "cache", "asx");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, "schema.json"), JSON.stringify(schema));
}

async function runCli(args: string[], input?: string) {
  const proc = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: tmpDir,
      XDG_CACHE_HOME: join(tmpDir, "cache"),
      XDG_CONFIG_HOME: join(tmpDir, "config"),
    },
    ...(input !== undefined ? { stdin: "pipe" as const } : {}),
    stdout: "pipe",
    stderr: "pipe",
  });

  if (input !== undefined) {
    proc.stdin.write(input);
    proc.stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "asx-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("cli", () => {
  test("dry-run returns the built request as json without requiring auth", async () => {
    writeCompiledSchema({
      version: "1.0",
      generated: "2026-01-01T00:00:00.000Z",
      source: "test",
      stats: { endpointCount: 1, bodyEndpointCount: 0, fieldCount: 2 },
      endpoints: [
        {
          method: "GET",
          path: "/tasks/{task_gid}",
          entity: "tasks",
          summary: "Get a task",
          pathParams: [{ name: "task_gid", type: "string", required: true }],
          queryFields: [{ name: "opt_fields", type: "array" }],
          bodyFields: [],
        },
      ],
    });

    const result = await runCli([
      "tasks",
      "get",
      "123",
      "--opt-fields",
      "name,assignee",
      "--dry-run",
    ]);

    const payload = JSON.parse(result.stdout) as {
      meta: Record<string, unknown>;
      data: {
        method: string;
        path: string;
        query: Record<string, string | string[]> | null;
        body: Record<string, unknown> | null;
      };
    };

    expect(result.exitCode).toBe(0);
    expect(payload.meta).toEqual({
      command: "tasks.get",
      dryRun: true,
    });
    expect(payload.data).toEqual({
      method: "GET",
      path: "/tasks/123",
      query: { opt_fields: ["name", "assignee"] },
      body: null,
    });
    expect(result.stderr).toBe("");
  });

  test("describe endpoint returns the compiled endpoint contract", async () => {
    const endpoint: EndpointSpec = {
      method: "GET",
      path: "/tasks/{task_gid}",
      entity: "tasks",
      summary: "Get a task",
      pathParams: [{ name: "task_gid", type: "string", required: true }],
      queryFields: [{ name: "opt_fields", type: "array" }],
      bodyFields: [],
    };

    writeCompiledSchema({
      version: "1.0",
      generated: "2026-01-01T00:00:00.000Z",
      source: "test",
      stats: { endpointCount: 1, bodyEndpointCount: 0, fieldCount: 2 },
      endpoints: [endpoint],
    });

    const result = await runCli(["describe", "tasks", "get"]);
    const payload = JSON.parse(result.stdout) as {
      meta: Record<string, unknown>;
      data: EndpointSpec;
    };

    expect(result.exitCode).toBe(0);
    expect(payload.meta).toEqual({
      command: "describe.endpoint",
    });
    expect(payload.data).toEqual(endpoint);
    expect(payload.data).not.toHaveProperty("args");
  });

  test("describe flat sub-resource endpoint returns the compiled endpoint contract", async () => {
    const listEndpoint: EndpointSpec = {
      method: "GET",
      path: "/tasks/{task_gid}/subtasks",
      entity: "tasks",
      summary: "Get subtasks",
      pathParams: [{ name: "task_gid", type: "string", required: true }],
      queryFields: [],
      bodyFields: [],
    };
    const createEndpoint: EndpointSpec = {
      method: "POST",
      path: "/tasks/{task_gid}/subtasks",
      entity: "tasks",
      summary: "Create a subtask",
      pathParams: [{ name: "task_gid", type: "string", required: true }],
      queryFields: [],
      bodyFields: [{ name: "name", type: "string", required: true }],
    };

    writeCompiledSchema({
      version: "1.0",
      generated: "2026-01-01T00:00:00.000Z",
      source: "test",
      stats: { endpointCount: 2, bodyEndpointCount: 1, fieldCount: 3 },
      endpoints: [listEndpoint, createEndpoint],
    });

    const result = await runCli(["describe", "tasks", "create-subtasks"]);
    const payload = JSON.parse(result.stdout) as {
      meta: Record<string, unknown>;
      data: EndpointSpec;
    };

    expect(result.exitCode).toBe(0);
    expect(payload.meta).toEqual({
      command: "describe.endpoint",
    });
    expect(payload.data).toEqual(createEndpoint);
    expect(payload.data).not.toHaveProperty("args");
  });

  test("unknown command without cached schema suggests schema update", async () => {
    const result = await runCli(["tasks", "get", "123"]);
    const payload = JSON.parse(result.stderr) as {
      error: { message: string; help: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.error.message).toBe('Unknown command "tasks".');
    expect(payload.error.help).toContain("asx schema update");
  });

  test("auth add rejects an empty token", async () => {
    const result = await runCli(["auth", "add", "work"], "\n");
    const payload = JSON.parse(result.stderr) as {
      error: { message: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.error.message).toBe("Token is empty.");
  });

  test("auth add emits a json acknowledgement", async () => {
    const result = await runCli(["auth", "add", "work"], "1/100:test\n");
    const payload = JSON.parse(result.stdout) as {
      meta: Record<string, unknown>;
      data: Record<string, unknown>;
    };

    expect(result.exitCode).toBe(0);
    expect(payload.meta).toEqual({ command: "auth.add" });
    expect(payload.data).toEqual({ account: "work", added: true });
    expect(result.stderr).toBe("");
  });
});
