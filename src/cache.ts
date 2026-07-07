import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as v from "valibot";

import { compileSchema, type CompiledSchema } from "@/compiler";
import { CliError, HTTP_TIMEOUT_MS, toCliError } from "@/errors";
import { xdgDir } from "@/utils";

const SPEC_URL =
  "https://raw.githubusercontent.com/Asana/openapi/master/defs/asana_oas.yaml";
const HttpMethodSchema = v.picklist(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const EnumValuesSchema = v.pipe(
  v.array(v.nullable(v.string())),
  v.transform((values) =>
    values.filter((value): value is string => value !== null),
  ),
);
const EndpointFieldItemsSchema = v.object({
  type: v.string(),
  oneOfTypes: v.optional(v.array(v.string())),
  enum: v.optional(EnumValuesSchema),
});
const EndpointFieldSchema = v.object({
  name: v.string(),
  type: v.string(),
  oneOfTypes: v.optional(v.array(v.string())),
  required: v.optional(v.literal(true)),
  enum: v.optional(EnumValuesSchema),
  format: v.optional(v.string()),
  description: v.optional(v.string()),
  items: v.optional(EndpointFieldItemsSchema),
});
const EndpointSpecSchema = v.object({
  method: HttpMethodSchema,
  path: v.string(),
  entity: v.string(),
  summary: v.string(),
  pathParams: v.array(EndpointFieldSchema),
  queryFields: v.array(EndpointFieldSchema),
  bodyFields: v.array(EndpointFieldSchema),
});
const CompiledSchemaSchema = v.strictObject({
  version: v.string(),
  generated: v.pipe(v.string(), v.isoTimestamp()),
  source: v.string(),
  stats: v.strictObject({
    endpointCount: v.pipe(v.number(), v.integer()),
    bodyEndpointCount: v.pipe(v.number(), v.integer()),
    fieldCount: v.pipe(v.number(), v.integer()),
  }),
  endpoints: v.array(EndpointSpecSchema),
});

function getCachedSchemaPath(): string {
  return join(xdgDir("cache"), "schema.json");
}

function invalidCachedSchemaError(cause?: unknown): CliError {
  return new CliError({
    kind: "config",
    message: "Cached schema is invalid.",
    help: "Run `asnx schema update` to rebuild it.",
    cause,
  });
}

function cacheWriteError(cause: unknown): CliError {
  return new CliError({
    kind: "config",
    message: "Failed to write cached schema.",
    help: "Run `asnx schema update` to rebuild it.",
    cause,
  });
}

export function hasCachedSchema(): boolean {
  return existsSync(getCachedSchemaPath());
}

export function loadCachedSchema(): CompiledSchema {
  const path = getCachedSchemaPath();
  if (!existsSync(path)) {
    throw new CliError({
      kind: "config",
      message: "No cached schema found. Run `asnx schema update` first.",
    });
  }
  let cached: string;
  try {
    cached = readFileSync(path, "utf-8");
  } catch (err) {
    throw invalidCachedSchemaError(err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cached);
  } catch (err) {
    throw invalidCachedSchemaError(err);
  }

  const result = v.safeParse(CompiledSchemaSchema, parsed);
  if (!result.success) {
    throw invalidCachedSchemaError(result.issues);
  }
  return result.output;
}

export async function updateSchemaCache(): Promise<CompiledSchema> {
  let response: Response;
  try {
    response = await fetch(SPEC_URL, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    throw toCliError(err);
  }
  if (!response.ok) {
    throw new CliError({
      kind: "api",
      status: response.status,
      message: `Failed to fetch spec: HTTP ${response.status}`,
    });
  }
  const yaml = await response.text();
  const compiledSchema = compileSchema(yaml, SPEC_URL);
  try {
    mkdirSync(xdgDir("cache"), { recursive: true });
    writeFileSync(getCachedSchemaPath(), JSON.stringify(compiledSchema));
  } catch (err) {
    throw cacheWriteError(err);
  }
  return compiledSchema;
}
