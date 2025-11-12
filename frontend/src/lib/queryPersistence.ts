import { persistQueryClient } from "@tanstack/react-query-persist-client";
import type {
  Persister,
  PersistedClient,
} from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import queryClient from "./queryClient";
import { groupsKey } from "../hooks/useGroupsQuery";
import { datingProfilesKey } from "../hooks/useDatingProfilesQuery";

const STORAGE_KEY = "tm:qcache:v1";
let isInitialized = false;

const persistedKeyRoots = new Set([
  JSON.stringify(groupsKey),
  JSON.stringify(datingProfilesKey),
]);

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === "function";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Recursively removes functions and Promises so IndexedDB structured clone succeeds.
function deepSanitize<T>(
  value: T,
  seen: WeakMap<object, unknown> = new WeakMap()
): T {
  if (typeof value === "function") {
    return undefined as unknown as T;
  }

  if (isPromiseLike(value)) {
    return undefined as unknown as T;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const objectValue = value as unknown as object;

  if (seen.has(objectValue)) {
    return seen.get(objectValue) as T;
  }

  if (Array.isArray(value)) {
    const arrayValue = value as unknown[];
    const result: unknown[] = [];
    seen.set(objectValue, result);
    let mutated = false;

    for (let index = 0; index < arrayValue.length; index += 1) {
      const current = arrayValue[index];
      const sanitizedItem = deepSanitize(current, seen);
      result[index] = sanitizedItem;
      if (!mutated && sanitizedItem !== current) {
        mutated = true;
      }
    }

    if (!mutated) {
      seen.set(objectValue, arrayValue);
      return value;
    }

    return result as unknown as T;
  }

  if (value instanceof Map) {
    const mapValue = value as Map<unknown, unknown>;
    const result = new Map<unknown, unknown>();
    seen.set(objectValue, result);
    let mutated = false;

    for (const [key, entry] of mapValue.entries()) {
      const sanitizedEntry = deepSanitize(entry, seen);
      if (!mutated && sanitizedEntry !== entry) {
        mutated = true;
      }
      if (sanitizedEntry !== undefined || entry === undefined) {
        result.set(key, sanitizedEntry);
      } else {
        mutated = true;
      }
    }

    if (!mutated) {
      seen.set(objectValue, mapValue);
      return value;
    }

    return result as unknown as T;
  }

  if (value instanceof Set) {
    const setValue = value as Set<unknown>;
    const result = new Set<unknown>();
    seen.set(objectValue, result);
    let mutated = false;

    for (const entry of setValue.values()) {
      const sanitizedEntry = deepSanitize(entry, seen);
      if (!mutated && sanitizedEntry !== entry) {
        mutated = true;
      }
      if (sanitizedEntry !== undefined || entry === undefined) {
        result.add(sanitizedEntry);
      } else {
        mutated = true;
      }
    }

    if (!mutated) {
      seen.set(objectValue, setValue);
      return value;
    }

    return result as unknown as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const originalEntries = Object.entries(value as Record<string, unknown>);
  const result: Record<string, unknown> = {};
  seen.set(objectValue, result);
  let mutated = false;

  for (const [key, entryValue] of originalEntries) {
    if (typeof entryValue === "function" || isPromiseLike(entryValue)) {
      mutated = true;
      continue;
    }

    const sanitizedValue = deepSanitize(entryValue, seen);
    if (!mutated && sanitizedValue !== entryValue) {
      mutated = true;
    }

    if (sanitizedValue !== undefined || entryValue === undefined) {
      result[key] = sanitizedValue;
    } else {
      mutated = true;
    }
  }

  if (!mutated) {
    seen.set(objectValue, value);
    return value;
  }

  return result as unknown as T;
}

function matchesPersistedKey(key: unknown): boolean {
  if (!Array.isArray(key)) return false;
  if (key.length < 2) return false;
  const root = JSON.stringify(key.slice(0, 2));
  return persistedKeyRoots.has(root);
}

function sanitizePersistedClient(client: PersistedClient): PersistedClient {
  if (!client) {
    return client;
  }

  const sanitized = deepSanitize(client) as PersistedClient;
  return sanitized;
}

const persister: Persister = {
  persistClient: async (client) => {
    try {
      const sanitized = sanitizePersistedClient(client);
      await set(STORAGE_KEY, sanitized);
    } catch (error) {
      console.warn("[QueryPersistence] persist failed", error);
    }
  },
  restoreClient: async () => {
    try {
      const persisted = await get<PersistedClient>(STORAGE_KEY);
      if (!persisted) {
        return undefined;
      }

      const sanitized = sanitizePersistedClient(persisted);

      if (sanitized.clientState?.queries) {
        try {
          for (const query of sanitized.clientState.queries as any[]) {
            const state = query?.state;
            if (
              state &&
              state.promise &&
              typeof state.promise.then !== "function"
            ) {
              delete state.promise;
            }
          }
        } catch {
          /* ignore sanitization issues */
        }
      }
      return sanitized;
    } catch (error) {
      console.warn("[QueryPersistence] restore failed", error);
      return undefined;
    }
  },
  removeClient: async () => {
    try {
      await del(STORAGE_KEY);
    } catch (error) {
      console.warn("[QueryPersistence] remove failed", error);
    }
  },
};

export function initQueryPersistence(): void {
  if (isInitialized || typeof window === "undefined") {
    return;
  }

  isInitialized = true;

  const [unsubscribe, restorePromise] = persistQueryClient({
    queryClient,
    persister,
    maxAge: 1000 * 60 * 60 * 24,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => matchesPersistedKey(query.queryKey),
    },
  });

  restorePromise.catch((error: unknown) => {
    console.warn("[QueryPersistence] setup failed", error);
  });

  window.addEventListener("pagehide", unsubscribe, { once: true });
}
