import type { QueryKey } from "@tanstack/react-query";
import queryClient from "./queryClient";

type CacheLogContext = {
  loader: string;
  resource: string;
};

type EnsureQueryOptions<TData> = {
  queryKey: QueryKey;
  queryFn: () => Promise<TData>;
  staleTime?: number;
  gcTime?: number;
};

const defaultStaleFallback = 0;

function isFreshCache(
  state: unknown,
  staleTime: number
): state is {
  dataUpdatedAt: number;
} {
  if (!state || typeof state !== "object") {
    return false;
  }

  const record = state as {
    status?: string;
    data?: unknown;
    dataUpdatedAt?: number;
    isInvalidated?: boolean;
  };

  if (record.status !== "success") {
    return false;
  }

  if (!("data" in record)) {
    return false;
  }

  if (record.isInvalidated) {
    return false;
  }

  const updatedAt =
    typeof record.dataUpdatedAt === "number" ? record.dataUpdatedAt : 0;
  if (updatedAt <= 0) {
    return false;
  }

  if (!Number.isFinite(staleTime)) {
    // Treat Infinity as always fresh
    return true;
  }

  if (staleTime <= 0) {
    return false;
  }

  return Date.now() - updatedAt < staleTime;
}

function formatQueryKey(key: QueryKey): string {
  if (Array.isArray(key)) {
    return key
      .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
      .join(" > ");
  }
  return typeof key === "string" ? key : JSON.stringify(key);
}

export async function ensureQueryDataWithDiagnostics<TData>(
  options: EnsureQueryOptions<TData>,
  context: CacheLogContext
): Promise<TData> {
  const state = queryClient.getQueryState<TData>(options.queryKey);
  const defaultStaleTime = queryClient.getDefaultOptions().queries?.staleTime;
  const staleTime =
    typeof options.staleTime === "number"
      ? options.staleTime
      : typeof defaultStaleTime === "number"
      ? defaultStaleTime
      : defaultStaleFallback;

  const queryLabel = formatQueryKey(options.queryKey);
  const cacheIsFresh = isFreshCache(state, staleTime);
  const prefix = `[RouteData] ${context.loader}`;

  if (cacheIsFresh) {
    console.log(
      `${prefix}: using cached data for ${context.resource} (${queryLabel})`
    );
  } else {
    console.log(
      `${prefix}: fetching fresh data for ${context.resource} (${queryLabel})`
    );
  }

  const data = await queryClient.ensureQueryData(options);

  if (!cacheIsFresh) {
    console.log(
      `${prefix}: fresh data resolved for ${context.resource} (${queryLabel})`
    );
  }

  return data;
}

export function isQueryFresh<TData>(
  queryKey: QueryKey,
  options?: { staleTime?: number }
): boolean {
  const state = queryClient.getQueryState<TData>(queryKey);
  if (!state) {
    return false;
  }

  const defaultStaleTime = queryClient.getDefaultOptions().queries?.staleTime;
  const staleTime =
    typeof options?.staleTime === "number"
      ? options.staleTime
      : typeof defaultStaleTime === "number"
      ? defaultStaleTime
      : defaultStaleFallback;

  return isFreshCache(state, staleTime);
}
