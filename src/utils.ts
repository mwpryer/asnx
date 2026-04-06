import { join } from "node:path";

const CAMEL_BOUNDARY_RE = /([a-z0-9])([A-Z])/g;
const UNDERSCORE_RE = /_/g;
const WHITESPACE_RE = /\s+/g;
const HTML_TAG_RE = /<[^>]+>/g;
const MAX_DESCRIPTION_LENGTH = 120;
const ELLIPSIS = "...";
export const HTTP_TIMEOUT_MS = 30_000;

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function xdgDir(type: "config" | "cache"): string {
  let envKey: string;
  let fallback: string;
  if (type === "config") {
    envKey = "XDG_CONFIG_HOME";
    fallback = ".config";
  } else {
    envKey = "XDG_CACHE_HOME";
    fallback = ".cache";
  }
  const base = process.env[envKey] ?? join(process.env.HOME!, fallback);
  return join(base, "asx");
}

export function toKebab(str: string): string {
  return str
    .replace(CAMEL_BOUNDARY_RE, "$1-$2")
    .replace(UNDERSCORE_RE, "-")
    .toLowerCase();
}

export function normalizeEntity(tag: string): string {
  return tag.toLowerCase().replace(WHITESPACE_RE, "-");
}

export function truncate(str: string | undefined): string | undefined {
  if (!str) {
    return undefined;
  }
  const clean = str.replace(HTML_TAG_RE, "").replace(WHITESPACE_RE, " ").trim();
  if (clean.length <= MAX_DESCRIPTION_LENGTH) {
    return clean;
  }
  return clean.slice(0, MAX_DESCRIPTION_LENGTH - ELLIPSIS.length) + ELLIPSIS;
}

export function buildQueryString(
  query: Record<string, string | string[]>,
): string {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(query)) {
    if (Array.isArray(val)) {
      params.set(key, val.join(","));
    } else {
      params.set(key, val);
    }
  }
  return params.toString();
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
