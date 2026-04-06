import type { HttpMethod } from "@/client";
import type { CompiledSchema, EndpointSpec } from "@/compiler";
import { CliError } from "@/errors";
import { toKebab } from "@/utils";

export type RouteMap = Map<string, Map<string, EndpointSpec>>;

function routeConfigError(message: string): CliError {
  return new CliError({
    kind: "config",
    message,
  });
}

// Strip braces from path params
function parentFromGid(gidSegment: string): string {
  const raw = gidSegment.slice(1, -1);
  const name = raw.endsWith("_gid") ? raw.slice(0, -4) : raw;
  return toKebab(name);
}

function parentName(segments: string[], childIndex: number): string {
  const parent = segments[childIndex - 1];
  if (!parent?.startsWith("{")) {
    const path = "/" + segments.join("/");
    throw routeConfigError(
      `Unsupported parent path shape for route derivation: ${path}`,
    );
  }
  return parentFromGid(parent);
}

function deriveSegments(path: string): {
  segments: string[];
  nonGid: string[];
} {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw routeConfigError(
      `Unsupported path shape for route derivation: ${path || "/"}`,
    );
  }

  const nonGid = segments.filter((segment) => !segment.startsWith("{"));
  if (nonGid.length === 0) {
    throw routeConfigError(
      `Unsupported path shape for route derivation: ${path || "/"}`,
    );
  }

  return { segments, nonGid };
}

const CRUD: Record<HttpMethod, string> = {
  GET: "get",
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

function deriveRouteAction(
  endpoint: EndpointSpec,
  pathHasGet: boolean,
): string {
  const { segments, nonGid } = deriveSegments(endpoint.path);
  // deriveSegments guarantees both arrays are non-empty
  const firstResource = toKebab(nonGid[0]!);
  const last = segments[segments.length - 1]!;

  if (last.startsWith("{")) {
    const base = CRUD[endpoint.method]!;

    if (nonGid.length === 1) {
      if (firstResource === endpoint.entity) {
        return base;
      }
      return `${base}-${firstResource}`;
    }

    const lastNonGid = nonGid[nonGid.length - 1]!;
    const lastNonGidKebab = toKebab(lastNonGid);

    if (lastNonGidKebab === endpoint.entity) {
      const parent = parentName(segments, segments.lastIndexOf(lastNonGid));
      return `${base}-for-${parent}`;
    }

    return lastNonGidKebab;
  }

  if (nonGid.length === 1) {
    return endpoint.method === "GET" ? "list" : "create";
  }

  const lastNonGid = nonGid[nonGid.length - 1]!;
  const lastKebab = toKebab(lastNonGid);

  if (lastKebab === endpoint.entity) {
    const parent = parentName(segments, segments.lastIndexOf(lastNonGid));

    return endpoint.method === "GET" ? `for-${parent}` : `create-for-${parent}`;
  }

  if (endpoint.method === "POST" && pathHasGet) {
    return `create-${lastKebab}`;
  }

  return lastKebab;
}

function addRoute(
  routes: RouteMap,
  endpoint: EndpointSpec,
  pathHasGet: boolean,
): void {
  const action = deriveRouteAction(endpoint, pathHasGet);
  if (!routes.has(endpoint.entity)) {
    routes.set(endpoint.entity, new Map());
  }
  const entityRoutes = routes.get(endpoint.entity)!;
  if (entityRoutes.has(action)) {
    throw routeConfigError(
      `Route action collision for entity "${endpoint.entity}": "${action}".`,
    );
  }
  entityRoutes.set(action, endpoint);
}

export function buildRoutes(schema: CompiledSchema): RouteMap {
  const routes: RouteMap = new Map();
  const getPaths = new Set<string>();
  const rest: EndpointSpec[] = [];

  for (const endpoint of schema.endpoints) {
    if (endpoint.method === "GET") {
      getPaths.add(endpoint.path);
      addRoute(routes, endpoint, true);
    } else {
      // Defer non-GET so POST can see sibling GET
      rest.push(endpoint);
    }
  }

  for (const endpoint of rest) {
    addRoute(routes, endpoint, getPaths.has(endpoint.path));
  }

  return routes;
}

export function resolveRoute(
  routes: RouteMap,
  entity: string,
  action: string,
): EndpointSpec | undefined {
  return routes.get(entity)?.get(action);
}
