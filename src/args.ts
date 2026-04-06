import type { ArgsDef } from "citty";

import type { EndpointField, EndpointSpec } from "@/compiler";
import { toKebab } from "@/utils";

export const GLOBAL_FLAG_DEFS: ArgsDef = {
  "dry-run": {
    type: "boolean",
    description: "Preview request only; does not call Asana",
  },
  json: { type: "string", description: "Raw JSON request body" },
  account: { type: "string", description: "Named account" },
};

function withRequired(
  description: string | undefined,
  required?: boolean,
): string | undefined {
  if (!required) {
    return description;
  }
  if (!description) {
    return "[required]";
  }
  return `[required] ${description}`;
}

function hintForType(field: EndpointField): string | undefined {
  if (field.enum && field.enum.length > 0 && field.enum.length <= 6) {
    return field.enum.join("|");
  }
  if (field.oneOfTypes && field.oneOfTypes.length > 1) {
    return field.oneOfTypes.join("|");
  }
  if (field.type === "boolean") {
    return "true|false";
  }
  if (field.type === "integer" || field.type === "number") {
    return "value";
  }
  if (field.format === "date") {
    return "YYYY-MM-DD";
  }
  if (field.format === "date-time") {
    return "ISO-8601";
  }
  if (field.type === "array") {
    if (field.items?.enum && field.items.enum.length <= 6) {
      return field.items.enum.join(",");
    }
    if (field.items?.oneOfTypes && field.items.oneOfTypes.length > 1) {
      return field.items.oneOfTypes.join("|");
    }
    return "a,b";
  }
  return undefined;
}

export function buildArgMap(endpoint: EndpointSpec): ArgsDef {
  const args: ArgsDef = {};

  for (const field of endpoint.pathParams) {
    const cliName = toKebab(field.name);
    args[cliName] = field.required
      ? { type: "positional", required: true }
      : { type: "positional" };
  }

  for (const field of endpoint.queryFields) {
    const cliName = toKebab(field.name);
    args[cliName] = buildFlagArg(field);
  }

  for (const field of endpoint.bodyFields) {
    const cliName = toKebab(field.name);
    args[cliName] = buildFlagArg(field);
  }

  return args;
}

function buildFlagArg(field: EndpointField): ArgsDef[string] {
  const description = withRequired(field.description, field.required);
  const valueHint = hintForType(field);
  return {
    type: "string",
    ...(description ? { description } : {}),
    ...(valueHint ? { valueHint } : {}),
  };
}
