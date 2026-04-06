import { parse as parseYaml } from "yaml";

import type { HttpMethod } from "@/client";
import { CliError } from "@/errors";
import { isPlainObject, normalizeEntity, truncate } from "@/utils";

export interface EndpointFieldItems {
  type: string;
  // Mirror of EndpointField.oneOfTypes for array items
  oneOfTypes?: string[];
  enum?: string[];
}

export interface EndpointField {
  name: string;
  type: string;
  // Full union when oneOf/anyOf branches diverge, `type` holds the CLI-friendly primary
  oneOfTypes?: string[];
  required?: true;
  enum?: string[];
  format?: string;
  description?: string;
  items?: EndpointFieldItems;
}

export interface EndpointSpec {
  method: HttpMethod;
  path: string;
  entity: string;
  summary: string;
  pathParams: EndpointField[];
  queryFields: EndpointField[];
  bodyFields: EndpointField[];
}

export interface CompiledSchema {
  version: string;
  generated: string;
  source: string;
  stats: {
    endpointCount: number;
    bodyEndpointCount: number;
    fieldCount: number;
  };
  endpoints: EndpointSpec[];
}

interface OpenApiRef {
  $ref: string;
}

type OpenApiRefable<T> = T | OpenApiRef | undefined;

interface OpenApiSchema {
  type?: string;
  properties?: Record<string, OpenApiRefable<OpenApiSchema>>;
  required?: string[];
  allOf?: OpenApiRefable<OpenApiSchema>[];
  oneOf?: OpenApiRefable<OpenApiSchema>[];
  anyOf?: OpenApiRefable<OpenApiSchema>[];
  discriminator?: unknown;
  enum?: unknown[];
  format?: string;
  description?: string;
  items?: OpenApiRefable<OpenApiSchema>;
  readOnly?: boolean;
  [key: string]: unknown;
}

interface OpenApiMediaType {
  schema?: OpenApiRefable<OpenApiSchema>;
}

interface OpenApiRequestBody {
  content?: Record<string, OpenApiMediaType>;
  [key: string]: unknown;
}

interface OpenApiParameter {
  name: string;
  in: "path" | "query";
  required?: boolean;
  description?: string;
  schema?: OpenApiRefable<OpenApiSchema>;
  [key: string]: unknown;
}

interface OpenApiOperation {
  tags?: string[];
  summary: string;
  description?: string;
  parameters?: OpenApiRefable<OpenApiParameter>[];
  requestBody?: OpenApiRefable<OpenApiRequestBody>;
  responses?: Record<string, OpenApiRefable<OpenApiResponse>>;
}

interface OpenApiResponse {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
  [key: string]: unknown;
}

interface OpenApiPathItem {
  parameters?: OpenApiRefable<OpenApiParameter>[];
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
}

interface OpenApiSpec {
  info: {
    version: string;
  };
  paths: Record<string, OpenApiPathItem>;
  [key: string]: unknown;
}

function invalidSpecError(message: string, cause?: unknown): CliError {
  return new CliError({
    kind: "config",
    message,
    cause,
  });
}

function requireRefableArray<T>(
  value: OpenApiRefable<T>[] | undefined,
  message: string,
): OpenApiRefable<T>[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidSpecError(message);
  }
  return value;
}

function parseOpenApiSpec(yamlContent: string): OpenApiSpec {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlContent);
  } catch (err) {
    throw invalidSpecError("Failed to parse OpenAPI spec YAML.", err);
  }

  if (!isPlainObject(parsed)) {
    throw invalidSpecError("OpenAPI spec root must be an object.");
  }

  if (!isPlainObject(parsed.info) || typeof parsed.info.version !== "string") {
    throw invalidSpecError("OpenAPI spec is missing info.version.");
  }

  if (!isPlainObject(parsed.paths)) {
    throw invalidSpecError("OpenAPI spec is missing paths.");
  }

  return parsed as OpenApiSpec;
}

// Resolve JSON pointer against parsed spec
function lookupRef(spec: OpenApiSpec, ref: string): unknown {
  const parts = ref.replace(/^#\//, "").split("/");
  let cur: unknown = spec;
  for (const part of parts) {
    if (typeof cur !== "object" || cur === null || !(part in cur)) {
      throw invalidSpecError(`Unresolvable $ref in OpenAPI spec: ${ref}`);
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// Follow $ref chain to concrete value
function resolveRef<T>(
  spec: OpenApiSpec,
  obj: OpenApiRefable<T>,
): T | undefined {
  let current = obj;
  while (
    typeof current === "object" &&
    current !== null &&
    "$ref" in current &&
    typeof current.$ref === "string"
  ) {
    current = lookupRef(spec, current.$ref) as OpenApiRefable<T>;
  }
  return current as T | undefined;
}

const COMPOSITION_KEYS = new Set([
  "properties",
  "required",
  "allOf",
  "oneOf",
  "anyOf",
  "discriminator",
]);

// flattenSchema return: merged schema plus any divergent oneOf/anyOf union surfaced for the field
interface FlatSchema {
  schema: OpenApiSchema;
  oneOfTypes?: string[];
}

// Picks the CLI-ergonomic primary when collapsing a union, flag form uses primary, --json reaches the rest
const TYPE_PRIMARY_PREFERENCE = [
  "string",
  "integer",
  "number",
  "boolean",
  "array",
  "object",
];

function selectPrimaryType(types: string[]): string {
  for (const preferred of TYPE_PRIMARY_PREFERENCE) {
    if (types.includes(preferred)) {
      return preferred;
    }
  }
  return types[0] ?? "string";
}

// Start from sibling fields, then merge composed branches
function copySchema(schema: OpenApiSchema): OpenApiSchema {
  const copy: OpenApiSchema = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!COMPOSITION_KEYS.has(key)) {
      copy[key] = value;
    }
  }

  if (schema.properties) {
    copy.properties = { ...schema.properties };
  }
  if (schema.required) {
    copy.required = [...schema.required];
  }

  return copy;
}

// Preserve required for allOf, add shape for oneOf/anyOf
function mergeSchema(
  target: OpenApiSchema,
  source: OpenApiSchema | undefined,
  keepRequired: boolean,
): void {
  if (!source) {
    return;
  }

  if (source.properties) {
    target.properties ??= {};
    Object.assign(target.properties, source.properties);
  }

  if (keepRequired && source.required?.length) {
    target.required ??= [];
    target.required.push(...source.required);
  }

  for (const [key, value] of Object.entries(source)) {
    if (!COMPOSITION_KEYS.has(key)) {
      target[key] = value;
    }
  }
}

// Flatten composition to a plain schema and surface any divergent oneOf/anyOf union
function flattenSchema(
  spec: OpenApiSpec,
  rawSchema: OpenApiRefable<OpenApiSchema>,
): FlatSchema | undefined {
  const schema = resolveRef(spec, rawSchema);
  if (!schema) {
    return undefined;
  }
  if (!schema.allOf && !schema.oneOf && !schema.anyOf) {
    return { schema };
  }

  const flat = copySchema(schema);
  let oneOfTypes: string[] | undefined;

  const allOf = requireRefableArray(
    schema.allOf,
    "OpenAPI spec has invalid allOf composition.",
  );
  for (const branch of allOf) {
    const inner = flattenSchema(spec, branch);
    if (!inner) continue;
    mergeSchema(flat, inner.schema, true);
    // Propagate any divergent union surfaced by an inner branch through the outer allOf
    if (inner.oneOfTypes) {
      oneOfTypes = inner.oneOfTypes;
    }
  }

  const unionBranches = requireRefableArray(
    schema.oneOf ?? schema.anyOf,
    "OpenAPI spec has invalid oneOf/anyOf composition.",
  );

  // Resolve branches first so we can read post-ref types before mergeSchema clobbers parent
  const resolvedBranches = unionBranches
    .map((branch) => flattenSchema(spec, branch))
    .filter((r): r is FlatSchema => r !== undefined);

  const branchTypes = new Set<string>();
  for (const branch of resolvedBranches) {
    branchTypes.add(inferSchemaType(branch.schema));
  }

  for (const branch of resolvedBranches) {
    mergeSchema(flat, branch.schema, false);
  }

  // mergeSchema is lossy on `type` for divergent unions, record the full set and pick a primary
  if (branchTypes.size > 1) {
    oneOfTypes = [...branchTypes].sort();
    flat.type = selectPrimaryType(oneOfTypes);
  }

  if (flat.required?.length === 0) {
    delete flat.required;
  }
  return oneOfTypes ? { schema: flat, oneOfTypes } : { schema: flat };
}

function inferSchemaType(schema: OpenApiSchema | undefined): string {
  if (!schema) {
    return "string";
  }
  if (schema.type) {
    return schema.type;
  }
  if (schema.properties) {
    return "object";
  }
  if (schema.items) {
    return "array";
  }
  return "string";
}

function extractSchemaItems(
  spec: OpenApiSpec,
  rawItems: OpenApiRefable<OpenApiSchema> | undefined,
): EndpointFieldItems | undefined {
  if (!rawItems) {
    return undefined;
  }
  const flat = flattenSchema(spec, rawItems);
  if (!flat) {
    return undefined;
  }

  const extracted: EndpointFieldItems = {
    type: inferSchemaType(flat.schema),
  };
  if (flat.oneOfTypes) {
    extracted.oneOfTypes = flat.oneOfTypes;
  }
  const itemEnum = extractEnumValues(flat.schema.enum);
  if (itemEnum) {
    extracted.enum = itemEnum;
  }
  return extracted;
}

function extractEnumValues(
  values: unknown[] | undefined,
): string[] | undefined {
  if (!values) {
    return undefined;
  }

  const filtered = values.filter(
    (value): value is string => typeof value === "string",
  );
  return filtered.length > 0 ? filtered : undefined;
}

function extractParamField(
  spec: OpenApiSpec,
  param: OpenApiParameter,
): EndpointField | undefined {
  // Drop transport-only noise from CLI surface
  if (param.name === "opt_pretty") {
    return undefined;
  }

  const flat = flattenSchema(spec, param.schema);
  const schema = flat?.schema;
  const extracted: EndpointField = {
    name: param.name,
    type: inferSchemaType(schema),
  };
  if (flat?.oneOfTypes) {
    extracted.oneOfTypes = flat.oneOfTypes;
  }
  if (param.required) {
    extracted.required = true;
  }
  const paramEnum = extractEnumValues(schema?.enum);
  if (paramEnum) {
    extracted.enum = paramEnum;
  }
  if (schema?.format) {
    extracted.format = schema.format;
  }
  if (param.description) {
    extracted.description = truncate(param.description);
  }
  const items = extractSchemaItems(spec, schema?.items);
  if (items) {
    extracted.items = items;
  }
  return extracted;
}

// Merge path and op params, op wins by name+location
function extractParamFields(
  spec: OpenApiSpec,
  pathParams: OpenApiRefable<OpenApiParameter>[],
  opParams: OpenApiRefable<OpenApiParameter>[],
  location: "path" | "query",
): EndpointField[] {
  const merged = new Map<string, OpenApiParameter>();

  for (const raw of [...pathParams, ...opParams]) {
    const param = resolveRef(spec, raw);
    if (!param) {
      continue;
    }
    merged.set(`${param.name}:${param.in}`, param);
  }

  return [...merged.values()].flatMap((param) => {
    if (param.in !== location) {
      return [];
    }
    const field = extractParamField(spec, param);
    return field ? [field] : [];
  });
}

// Reduce writable body prop to field metadata
function extractBodyField(
  spec: OpenApiSpec,
  name: string,
  rawProp: OpenApiRefable<OpenApiSchema>,
  requiredSet: Set<string>,
): EndpointField | undefined {
  const flat = flattenSchema(spec, rawProp);
  if (!flat || flat.schema.readOnly === true) {
    return undefined;
  }

  const schema = flat.schema;
  const field: EndpointField = {
    name,
    type: schema.type ?? "string",
  };
  if (flat.oneOfTypes) {
    field.oneOfTypes = flat.oneOfTypes;
  }
  if (requiredSet.has(name)) {
    field.required = true;
  }
  const propEnum = extractEnumValues(schema.enum);
  if (propEnum) {
    field.enum = propEnum;
  }
  if (schema.format) {
    field.format = schema.format;
  }

  const items = extractSchemaItems(spec, schema.items);
  if (items) {
    field.items = items;
  }

  const desc = truncate(schema.description);
  if (desc) {
    field.description = desc;
  }

  return field;
}

// Only JSON bodies, writable payload under data
function extractBody(
  spec: OpenApiSpec,
  body: OpenApiRefable<OpenApiRequestBody>,
): EndpointField[] {
  const resolvedBody = resolveRef(spec, body);
  const jsonContent = resolvedBody?.content?.["application/json"];
  if (!jsonContent) {
    return [];
  }

  const requestSchema = flattenSchema(spec, jsonContent.schema);
  const dataSchema = flattenSchema(
    spec,
    requestSchema?.schema.properties?.data,
  );
  if (!dataSchema?.schema.properties) {
    return [];
  }

  const requiredSet = new Set<string>(dataSchema.schema.required ?? []);
  return Object.entries(dataSchema.schema.properties).flatMap(
    ([name, rawProp]) => {
      const field = extractBodyField(spec, name, rawProp, requiredSet);
      return field ? [field] : [];
    },
  );
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const METHOD_NAMES: Record<(typeof METHODS)[number], HttpMethod> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
};

// Parse spec into reduced CLI schema
export function compileSchema(
  yamlContent: string,
  source: string,
): CompiledSchema {
  const spec = parseOpenApiSpec(yamlContent);
  const endpoints: EndpointSpec[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const pathParams = requireRefableArray(
      pathItem.parameters,
      `OpenAPI spec has invalid path parameters: ${path}`,
    );

    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op) {
        continue;
      }

      const tag = op.tags?.[0];
      if (!tag) {
        throw invalidSpecError(
          `Unsupported operation without tag: ${method.toUpperCase()} ${path}`,
        );
      }
      if (!op.summary) {
        throw invalidSpecError(
          `OpenAPI operation is missing summary: ${method.toUpperCase()} ${path}`,
        );
      }

      const opParams = requireRefableArray(
        op.parameters,
        `OpenAPI spec has invalid operation parameters: ${method.toUpperCase()} ${path}`,
      );

      const pathFields = extractParamFields(spec, pathParams, opParams, "path");
      const queryFields = extractParamFields(
        spec,
        pathParams,
        opParams,
        "query",
      );
      const hasBody = method !== "get" && method !== "delete";
      const bodyFields = hasBody ? extractBody(spec, op.requestBody) : [];

      const endpoint: EndpointSpec = {
        method: METHOD_NAMES[method],
        path,
        entity: normalizeEntity(tag),
        summary: op.summary,
        pathParams: pathFields,
        queryFields,
        bodyFields,
      };
      endpoints.push(endpoint);
    }
  }

  const fieldCount = endpoints.reduce(
    (count, endpoint) =>
      count +
      endpoint.pathParams.length +
      endpoint.queryFields.length +
      endpoint.bodyFields.length,
    0,
  );

  return {
    version: spec.info.version,
    generated: new Date().toISOString(),
    source,
    stats: {
      endpointCount: endpoints.length,
      bodyEndpointCount: endpoints.filter(
        (endpoint) => endpoint.bodyFields.length > 0,
      ).length,
      fieldCount,
    },
    endpoints,
  };
}
