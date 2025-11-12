const LEADING_SLASH = /^\/+|^\s+/g;
const TRAILING_SLASH = /\/+$/;

function ensureAbsolute(input: string): string {
  if (!input) return "/";
  const trimmed = input.replace(LEADING_SLASH, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function normalizeAppPath(path: string): string {
  const absolute = ensureAbsolute((path || "").trim());
  if (absolute === "/") return "/";
  const withoutTrailing = absolute.replace(TRAILING_SLASH, "");
  return withoutTrailing.length ? withoutTrailing : "/";
}

export function routeEquals(current: string, target: string): boolean {
  return normalizeAppPath(current) === normalizeAppPath(target);
}

export function routeStartsWith(current: string, prefix: string): boolean {
  const normalizedCurrent = normalizeAppPath(current);
  const normalizedPrefix = normalizeAppPath(prefix);
  if (normalizedPrefix === "/") return true;
  if (normalizedCurrent === normalizedPrefix) return true;
  return normalizedCurrent.startsWith(`${normalizedPrefix}/`);
}

function getCurrentPath(): string {
  if (typeof window === "undefined" || !window.location?.pathname) {
    return "/";
  }
  return window.location.pathname;
}

export function currentRouteEquals(target: string): boolean {
  return routeEquals(getCurrentPath(), target);
}

export function currentRouteStartsWith(prefix: string): boolean {
  return routeStartsWith(getCurrentPath(), prefix);
}

export default normalizeAppPath;
