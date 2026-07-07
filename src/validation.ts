import { GLOBAL_FLAG_DEFS } from "@/args";
import type { AsanaRequest } from "@/client";
import type {
  EndpointField,
  EndpointFieldItems,
  EndpointSpec,
} from "@/compiler";
import { CliError } from "@/errors";
import { isPlainObject, toKebab } from "@/utils";

export type FlagValue = string | boolean | string[];

interface CollectedFlag {
  field: EndpointField;
  cliName: string;
  value: FlagValue;
}

interface InputSource {
  kind: "flag" | "field";
  name: string;
}

interface CollectedInput {
  positionals: (string | undefined)[];
  queryFlags: CollectedFlag[];
  bodyFlags: CollectedFlag[];
  jsonBody?: string;
  // Keep raw argv, Citty parse is non-strict
  rawArgs?: string[];
}

interface ValidatedInput {
  path: string;
  query?: Record<string, string | string[]>;
  body?: Record<string, unknown>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sourceLabel(source: InputSource): string {
  return source.kind === "flag"
    ? `Flag --${source.name}`
    : `Field "${source.name}"`;
}

function invalidTypeError(
  source: InputSource,
  expected: string,
  value?: unknown,
): CliError {
  // Only flag callers carry a stringified raw value worth showing
  const got = source.kind === "flag" ? `, got "${String(value)}"` : "";
  return new CliError({
    kind: "usage",
    message: `${sourceLabel(source)}: expected ${expected}${got}.`,
  });
}

function invalidValueError(
  source: InputSource,
  value: unknown,
  allowed: string[],
): CliError {
  return new CliError({
    kind: "usage",
    message: `${sourceLabel(source)}: "${String(value)}" is not valid. Allowed: ${allowed.join(", ")}.`,
  });
}

function parseJsonBody(jsonStr: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new CliError({
      kind: "usage",
      message: "Invalid JSON in --json flag.",
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError({
      kind: "usage",
      message: "Flag --json: expected a JSON object.",
    });
  }

  if ("data" in parsed) {
    throw new CliError({
      kind: "usage",
      message:
        'Flag --json expects raw request fields, not a full {"data": ...} envelope.',
    });
  }

  return parsed as Record<string, unknown>;
}

function collectProvidedFlags(
  fields: EndpointField[],
  parsed: Record<string, unknown>,
): CollectedFlag[] {
  return fields.flatMap((field) => {
    const cliName = toKebab(field.name);
    const value = parsed[cliName];
    if (value == null) {
      return [];
    }
    // Cast safe: validateFlagValue rechecks the shape downstream
    return [{ field, cliName, value: value as FlagValue }];
  });
}

function buildKnownFlagMap(
  endpoint: EndpointSpec,
): Map<string, "boolean" | "string"> {
  const known = new Map<string, "boolean" | "string">();

  for (const [name, def] of Object.entries(GLOBAL_FLAG_DEFS)) {
    known.set(name, def.type === "boolean" ? "boolean" : "string");
  }
  // Citty injects --help implicitly
  known.set("help", "boolean");

  for (const field of endpoint.queryFields) {
    known.set(toKebab(field.name), "string");
  }

  for (const field of endpoint.bodyFields) {
    known.set(toKebab(field.name), "string");
  }

  return known;
}

// Recheck raw argv, Citty parse is permissive
function validateRawArgs(endpoint: EndpointSpec, rawArgs?: string[]): void {
  if (!rawArgs) {
    return;
  }

  const known = buildKnownFlagMap(endpoint);

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]!;
    if (arg === "--") {
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new CliError({
        kind: "usage",
        message: `Unknown flag ${arg}.`,
      });
    }

    const negated = arg.startsWith("--no-");
    const token = negated ? arg.slice(5) : arg.slice(2);
    const eqIndex = token.indexOf("=");
    const name = eqIndex === -1 ? token : token.slice(0, eqIndex);
    const flagType = known.get(name);

    if (!flagType) {
      throw new CliError({
        kind: "usage",
        message: `Unknown flag --${name}.`,
      });
    }

    if (negated && flagType !== "boolean") {
      throw new CliError({
        kind: "usage",
        // Preserve --no-json in error text
        message: `Unknown flag ${arg}.`,
      });
    }

    if (
      !negated &&
      eqIndex === -1 &&
      flagType === "string" &&
      i + 1 < rawArgs.length
    ) {
      i += 1;
    }
  }
}

function validateDate(value: string, source: InputSource): void {
  if (!ISO_DATE_RE.test(value)) {
    throw invalidTypeError(source, "date in YYYY-MM-DD format", value);
  }

  // Date round-trip catches impossible dates
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new CliError({
      kind: "usage",
      message: `${sourceLabel(source)}: "${value}" is not a real calendar date.`,
    });
  }
}

function validateEnum(
  value: unknown,
  allowed: string[] | undefined,
  source: InputSource,
): void {
  if (!allowed || value == null) {
    return;
  }
  // Stringify primitives so integer/number enums are comparable
  if (!allowed.includes(String(value))) {
    throw invalidValueError(source, value, allowed);
  }
}

function splitCsv(value: string | string[]): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function coerceFlagScalar(
  value: string,
  type: string,
  source: InputSource,
): string | number | boolean {
  switch (type) {
    case "integer": {
      const n = parseInt(value, 10);
      if (Number.isNaN(n)) {
        throw invalidTypeError(source, "integer", value);
      }
      return n;
    }
    case "number": {
      const n = parseFloat(value);
      if (Number.isNaN(n)) {
        throw invalidTypeError(source, "number", value);
      }
      return n;
    }
    case "boolean": {
      if (value === "true") {
        return true;
      }
      if (value === "false") {
        return false;
      }
      throw invalidTypeError(source, "boolean", value);
    }
    default:
      return value;
  }
}

function validateJsonScalar(
  value: unknown,
  type: string,
  source: InputSource,
): unknown {
  if (value === null) {
    return value;
  }

  switch (type) {
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw invalidTypeError(source, "integer");
      }
      return value;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw invalidTypeError(source, "number");
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        throw invalidTypeError(source, "boolean");
      }
      return value;
    case "string":
      if (typeof value !== "string") {
        throw invalidTypeError(source, "string");
      }
      return value;
    default:
      return value;
  }
}

function validateFlagArray(
  value: FlagValue,
  items: EndpointFieldItems | undefined,
  source: InputSource,
): unknown[] {
  if (typeof value === "boolean") {
    throw invalidTypeError(source, "comma-separated list", value);
  }

  const itemType = items?.type ?? "string";
  return splitCsv(value).map((entry) => {
    const coerced = coerceFlagScalar(entry, itemType, source);
    validateEnum(
      typeof coerced === "string" ? coerced : String(coerced),
      items?.enum,
      source,
    );
    return coerced;
  });
}

function validateJsonArray(
  value: unknown,
  items: EndpointFieldItems | undefined,
  source: InputSource,
): unknown {
  if (!Array.isArray(value)) {
    throw invalidTypeError(source, "array");
  }
  if (!items) {
    return value;
  }
  const allowed = items.oneOfTypes ?? [items.type];
  return value.map((item) =>
    validateJsonAgainstTypes(
      allowed,
      undefined,
      items.enum,
      undefined,
      item,
      source,
    ),
  );
}

// Shared union-aware dispatch used by validateJsonValue and validateJsonArray
function validateJsonAgainstTypes(
  allowed: string[],
  items: EndpointFieldItems | undefined,
  enumValues: string[] | undefined,
  format: string | undefined,
  value: unknown,
  source: InputSource,
): unknown {
  if (value === null) {
    return value;
  }

  const actual = jsonValueType(value);
  // Integer literals satisfy a "number" branch
  const matched = allowed.find(
    (t) => t === actual || (t === "number" && actual === "integer"),
  );
  if (!matched) {
    throw invalidTypeError(source, allowed.join(" or "));
  }

  if (matched === "array") {
    return validateJsonArray(value, items, source);
  }
  if (matched === "object") {
    return value;
  }

  const validated = validateJsonScalar(value, matched, source);
  if (typeof validated === "string" && format === "date") {
    validateDate(validated, source);
  }
  validateEnum(validated, enumValues, source);
  return validated;
}

function validateFlagValue(
  field: EndpointField,
  value: FlagValue,
  source: InputSource,
): unknown {
  if (field.type === "array") {
    return validateFlagArray(value, field.items, source);
  }

  if (field.type === "object") {
    throw new CliError({
      kind: "usage",
      message: `Flag --${source.name}: use --json for object values.`,
    });
  }

  if (Array.isArray(value)) {
    throw invalidTypeError(source, field.type);
  }

  const coerced =
    typeof value === "string"
      ? coerceFlagScalar(value, field.type, source)
      : value;

  if (typeof coerced === "string" && field.format === "date") {
    validateDate(coerced, source);
  }
  validateEnum(coerced, field.enum, source);
  return coerced;
}

function jsonValueType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (isPlainObject(value)) {
    return "object";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return "unknown";
}

function validateJsonValue(
  field: EndpointField,
  value: unknown,
  source: InputSource,
): unknown {
  // oneOfTypes carries the union for divergent oneOf/anyOf, otherwise collapses to single-type
  const allowed = field.oneOfTypes ?? [field.type];
  return validateJsonAgainstTypes(
    allowed,
    field.items,
    field.enum,
    field.format,
    value,
    source,
  );
}

function validateJsonBody(
  jsonBody: Record<string, unknown>,
  bodyFields: EndpointField[],
): Record<string, unknown> {
  const validated: Record<string, unknown> = {};
  const fieldMap = new Map(bodyFields.map((field) => [field.name, field]));

  for (const [name, value] of Object.entries(jsonBody)) {
    const field = fieldMap.get(name);
    if (!field) {
      throw new CliError({
        kind: "usage",
        message: `Unknown request field "${name}".`,
      });
    }

    validated[name] = validateJsonValue(field, value, {
      kind: "field",
      name,
    });
  }

  return validated;
}

function buildPathFromPositionals(
  path: string,
  pathParams: EndpointField[],
  positionals: (string | undefined)[],
): string {
  let filledPath = path;

  for (let i = 0; i < pathParams.length; i += 1) {
    const param = pathParams[i]!;
    const value = positionals[i];
    if (value == null && param.required) {
      throw new CliError({
        kind: "usage",
        message: `Missing required positional argument: ${param.name}.`,
      });
    }
    if (value != null) {
      filledPath = filledPath.replace(`{${param.name}}`, value);
    }
  }

  return filledPath;
}

function validateRequiredQuery(
  queryFields: EndpointField[],
  query: Record<string, string | string[]>,
): void {
  for (const field of queryFields) {
    if (field.required && !(field.name in query)) {
      throw new CliError({
        kind: "usage",
        message: `Missing required flag --${toKebab(field.name)}.`,
      });
    }
  }
}

function validateRequiredBody(
  bodyFields: EndpointField[],
  body: Record<string, unknown>,
): void {
  for (const field of bodyFields) {
    if (field.required && !(field.name in body)) {
      throw new CliError({
        kind: "usage",
        message: `Missing required request field: ${field.name}.`,
      });
    }
  }
}

export function collectInput(
  endpoint: EndpointSpec,
  parsed: Record<string, unknown>,
  rawArgs?: string[],
): CollectedInput {
  return {
    positionals: endpoint.pathParams.map(
      (field) => parsed[toKebab(field.name)] as string | undefined,
    ),
    queryFlags: collectProvidedFlags(endpoint.queryFields, parsed),
    bodyFlags: collectProvidedFlags(endpoint.bodyFields, parsed),
    jsonBody: typeof parsed.json === "string" ? parsed.json : undefined,
    rawArgs,
  };
}

export function validateInput(
  endpoint: EndpointSpec,
  input: CollectedInput,
): ValidatedInput {
  validateRawArgs(endpoint, input.rawArgs);

  const path = buildPathFromPositionals(
    endpoint.path,
    endpoint.pathParams,
    input.positionals,
  );
  const query: Record<string, string | string[]> = {};
  const bodyFromFlags: Record<string, unknown> = {};

  for (const { field, cliName, value } of input.queryFlags) {
    const validated = validateFlagValue(field, value, {
      kind: "flag",
      name: cliName,
    });
    if (Array.isArray(validated)) {
      query[field.name] = validated.map((item) => String(item));
    } else {
      query[field.name] = String(validated);
    }
  }

  for (const { field, cliName, value } of input.bodyFlags) {
    bodyFromFlags[field.name] = validateFlagValue(field, value, {
      kind: "flag",
      name: cliName,
    });
  }

  const jsonBody =
    input.jsonBody != null
      ? validateJsonBody(parseJsonBody(input.jsonBody), endpoint.bodyFields)
      : {};
  const mergedBody = { ...bodyFromFlags, ...jsonBody };

  validateRequiredQuery(endpoint.queryFields, query);
  validateRequiredBody(endpoint.bodyFields, mergedBody);

  // Asana answers empty write bodies with an unhelpful generic parse error
  if (endpoint.bodyFields.length > 0 && Object.keys(mergedBody).length === 0) {
    throw new CliError({
      kind: "usage",
      message:
        "No fields to send. Provide at least one field flag or a --json body.",
    });
  }

  return {
    path,
    query: Object.keys(query).length > 0 ? query : undefined,
    body:
      input.jsonBody != null || Object.keys(bodyFromFlags).length > 0
        ? mergedBody
        : undefined,
  };
}

export function buildHttpRequest(
  endpoint: EndpointSpec,
  input: ValidatedInput,
): AsanaRequest {
  const request: AsanaRequest = {
    method: endpoint.method,
    path: input.path,
  };

  if (input.query) {
    request.query = input.query;
  }
  if (input.body) {
    request.body = { data: input.body };
  }

  return request;
}
