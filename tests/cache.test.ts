import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCachedSchema, updateSchemaCache } from "@/cache";
import { CliError } from "@/errors";

let tmpDir: string;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "asnx-"));
  process.env.XDG_CACHE_HOME = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.XDG_CACHE_HOME;
  globalThis.fetch = originalFetch;
});

describe("loadCachedSchema", () => {
  test("loads compiled schema", () => {
    const cacheDir = join(tmpDir, "asnx");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, "schema.json"),
      JSON.stringify({
        version: "1.0",
        generated: "2026-01-01T00:00:00.000Z",
        source: "test",
        stats: { endpointCount: 1, bodyEndpointCount: 0, fieldCount: 3 },
        endpoints: [],
      }),
    );

    expect(loadCachedSchema()).toEqual({
      version: "1.0",
      generated: "2026-01-01T00:00:00.000Z",
      source: "test",
      stats: { endpointCount: 1, bodyEndpointCount: 0, fieldCount: 3 },
      endpoints: [],
    });
  });

  test("wraps invalid cached JSON as a config error", () => {
    const cacheDir = join(tmpDir, "asnx");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "schema.json"), "{");

    try {
      loadCachedSchema();
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe("Cached schema is invalid.");
      expect(err.help).toBe("Run `asnx schema update` to rebuild it.");
    }
  });

  test("wraps unreadable cached schema as a config error", () => {
    const cacheDir = join(tmpDir, "asnx");
    mkdirSync(join(cacheDir, "schema.json"), { recursive: true });

    try {
      loadCachedSchema();
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe("Cached schema is invalid.");
      expect(err.help).toBe("Run `asnx schema update` to rebuild it.");
    }
  });

  test("wraps structurally invalid cached schema as a config error", () => {
    const cacheDir = join(tmpDir, "asnx");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, "schema.json"),
      JSON.stringify({
        version: "1.0",
        generated: "2026-01-01T00:00:00.000Z",
        source: "test",
        stats: { endpointCount: 1, bodyEndpointCount: 0, fieldCount: 3 },
        endpoints: [
          {
            method: "TRACE",
            path: "/tasks/{task_gid}",
            entity: "tasks",
            summary: "Get a task",
            pathParams: [],
            queryFields: [],
            bodyFields: [],
          },
        ],
      }),
    );

    try {
      loadCachedSchema();
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe("Cached schema is invalid.");
      expect(err.help).toBe("Run `asnx schema update` to rebuild it.");
    }
  });

  test("loads cached schema with null enums by filtering them out", () => {
    const cacheDir = join(tmpDir, "asnx");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, "schema.json"),
      JSON.stringify({
        version: "1.0",
        generated: "2026-01-01T00:00:00.000Z",
        source: "test",
        stats: { endpointCount: 1, bodyEndpointCount: 0, fieldCount: 1 },
        endpoints: [
          {
            method: "GET",
            path: "/tags/{tag_gid}",
            entity: "tags",
            summary: "Get a tag",
            pathParams: [],
            queryFields: [
              { name: "color", type: "string", enum: ["blue", null] },
            ],
            bodyFields: [],
          },
        ],
      }),
    );

    expect(loadCachedSchema()).toEqual({
      version: "1.0",
      generated: "2026-01-01T00:00:00.000Z",
      source: "test",
      stats: { endpointCount: 1, bodyEndpointCount: 0, fieldCount: 1 },
      endpoints: [
        {
          method: "GET",
          path: "/tags/{tag_gid}",
          entity: "tags",
          summary: "Get a tag",
          pathParams: [],
          queryFields: [{ name: "color", type: "string", enum: ["blue"] }],
          bodyFields: [],
        },
      ],
    });
  });

  test("oneOfTypes on a body field round-trips through the cache validator", () => {
    const cacheDir = join(tmpDir, "asnx");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, "schema.json"),
      JSON.stringify({
        version: "1.0",
        generated: "2026-01-01T00:00:00.000Z",
        source: "test",
        stats: { endpointCount: 1, bodyEndpointCount: 1, fieldCount: 1 },
        endpoints: [
          {
            method: "POST",
            path: "/things/{thing_gid}/addCustomFieldSetting",
            entity: "things",
            summary: "Add a custom field",
            pathParams: [{ name: "thing_gid", type: "string", required: true }],
            queryFields: [],
            bodyFields: [
              {
                name: "custom_field",
                type: "string",
                oneOfTypes: ["object", "string"],
                required: true,
              },
            ],
          },
        ],
      }),
    );

    const loaded = loadCachedSchema();
    expect(loaded.endpoints[0]!.bodyFields[0]).toEqual({
      name: "custom_field",
      type: "string",
      oneOfTypes: ["object", "string"],
      required: true,
    });
  });

  test("loads cached schema with extra endpoint metadata", () => {
    const cacheDir = join(tmpDir, "asnx");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, "schema.json"),
      JSON.stringify({
        version: "1.0",
        generated: "2026-01-01T00:00:00.000Z",
        source: "test",
        stats: { endpointCount: 1, bodyEndpointCount: 0, fieldCount: 1 },
        endpoints: [
          {
            method: "GET",
            path: "/tags/{tag_gid}",
            entity: "tags",
            summary: "Get a tag",
            deprecated: true,
            pathParams: [],
            queryFields: [
              {
                name: "color",
                type: "string",
                source: "legacy",
              },
            ],
            bodyFields: [],
          },
        ],
      }),
    );

    expect(loadCachedSchema()).toEqual({
      version: "1.0",
      generated: "2026-01-01T00:00:00.000Z",
      source: "test",
      stats: { endpointCount: 1, bodyEndpointCount: 0, fieldCount: 1 },
      endpoints: [
        {
          method: "GET",
          path: "/tags/{tag_gid}",
          entity: "tags",
          summary: "Get a tag",
          pathParams: [],
          queryFields: [{ name: "color", type: "string" }],
          bodyFields: [],
        },
      ],
    });
  });
});

describe("updateSchemaCache", () => {
  test("wraps cache write failures as config errors", async () => {
    const cacheDir = join(tmpDir, "asnx");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(cacheDir, "blocked");
    globalThis.fetch = (async () =>
      new Response(
        [
          'openapi: "3.0.0"',
          'info: { title: test, version: "1.0" }',
          "paths: {}",
        ].join("\n"),
      )) as unknown as typeof fetch;

    try {
      await updateSchemaCache();
      expect.unreachable("should throw");
    } catch (err) {
      if (!(err instanceof CliError)) {
        throw err;
      }

      expect(err.kind).toBe("config");
      expect(err.message).toBe("Failed to write cached schema.");
      expect(err.help).toBe("Run `asnx schema update` to rebuild it.");
    }
  });
});
