import { create } from "zustand";
import {
  fetchMessageFilters,
  addMessageFilter,
  removeMessageFilter,
  type MessageFilterItem,
} from "../services/api";
import { useAuthStore } from "./authStore";

export type FilterEntry = {
  username: string;
  normalized: string;
  createdAt: number;
  updatedAt?: number;
};

type FilterSnapshot = {
  items?: FilterItem[];
  groups?: Record<string, string[]>;
};

type FilterItem = MessageFilterItem;

type FilterMap = Record<string, FilterEntry[]>;

interface MessageFilterState {
  filteredByGroup: FilterMap;
  lastFetchedAt: number | null;
  hydrateAll: (force?: boolean) => Promise<void>;
  hydrateGroup: (groupId: string, force?: boolean) => Promise<void>;
  addFilter: (groupId: string, username: string) => Promise<boolean>;
  removeFilter: (groupId: string, username: string) => Promise<boolean>;
  syncFromSnapshot: (snapshot: FilterSnapshot | null | undefined) => void;
  isFiltered: (groupId: string, username: string) => boolean;
}

const normalize = (value: string | undefined | null): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const coerceToMillis = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const buildMapFromItems = (items: FilterItem[] = []): FilterMap => {
  const buckets: Record<string, Map<string, FilterEntry>> = {};
  for (const item of items) {
    if (!item) continue;
    const groupId = (item.groupId || "").trim();
    const username = (item.username || "").trim();
    if (!groupId || !username) continue;
    const normalized = normalize(item.normalized) || normalize(username);
    if (!normalized) continue;
    const createdAt = coerceToMillis(item.createdAt) ?? Date.now();
    const updatedAt = coerceToMillis(item.updatedAt) ?? undefined;
    if (!buckets[groupId]) buckets[groupId] = new Map<string, FilterEntry>();
    buckets[groupId].set(normalized, {
      username,
      normalized,
      createdAt,
      ...(updatedAt ? { updatedAt } : {}),
    });
  }

  const map: FilterMap = {};
  for (const [groupId, bucket] of Object.entries(buckets)) {
    const list = Array.from(bucket.values()).sort(
      (a, b) => a.createdAt - b.createdAt
    );
    map[groupId] = list;
  }
  return map;
};

export const useMessageFilterStore = create<MessageFilterState>()(
  (set, get) => ({
    filteredByGroup: {},
    lastFetchedAt: null,

    hydrateAll: async (force = false) => {
      const userId = useAuthStore.getState().userId;
      if (!userId) return;
      const { lastFetchedAt } = get();
      const now = Date.now();
      if (!force && lastFetchedAt && now - lastFetchedAt < 10_000) return;
      try {
        const res = await fetchMessageFilters(userId);
        const nextMap = buildMapFromItems(res?.items || []);
        set({ filteredByGroup: nextMap, lastFetchedAt: Date.now() });
      } catch (e) {
        console.warn("hydrate message filters failed", e);
      }
    },

    hydrateGroup: async (groupId, force = false) => {
      const safeGroup = (groupId || "").trim();
      if (!safeGroup) return;
      const state = get();
      const hasGroup = Boolean(state.filteredByGroup[safeGroup]?.length);
      const recentlyFetched =
        typeof state.lastFetchedAt === "number" &&
        Date.now() - state.lastFetchedAt < 10_000;
      if (!force && (hasGroup || recentlyFetched)) return;
      await state.hydrateAll(force);
    },

    addFilter: async (groupId, username) => {
      const safeGroup = (groupId || "").trim();
      const safeUser = (username || "").trim();
      if (!safeGroup || !safeUser) return false;
      const userId = useAuthStore.getState().userId;
      if (!userId) return false;
      try {
        const res = await addMessageFilter(userId, {
          groupId: safeGroup,
          username: safeUser,
        });
        const nextMap = buildMapFromItems(res?.items || []);
        set({ filteredByGroup: nextMap, lastFetchedAt: Date.now() });
        return true;
      } catch (e) {
        console.warn("add message filter failed", e);
        return false;
      }
    },

    removeFilter: async (groupId, username) => {
      const safeGroup = (groupId || "").trim();
      const safeUser = (username || "").trim();
      if (!safeGroup || !safeUser) return false;
      const userId = useAuthStore.getState().userId;
      if (!userId) return false;
      try {
        const res = await removeMessageFilter(userId, {
          groupId: safeGroup,
          username: safeUser,
        });
        const nextMap = buildMapFromItems(res?.items || []);
        set({ filteredByGroup: nextMap, lastFetchedAt: Date.now() });
        return true;
      } catch (e) {
        console.warn("remove message filter failed", e);
        return false;
      }
    },

    syncFromSnapshot: (snapshot) => {
      if (!snapshot) return;
      const items = Array.isArray(snapshot.items) ? snapshot.items : [];
      const nextMap = buildMapFromItems(items);
      set({ filteredByGroup: nextMap, lastFetchedAt: Date.now() });
    },

    isFiltered: (groupId, username) => {
      const safeGroup = (groupId || "").trim();
      const safeUser = (username || "").trim();
      if (!safeGroup || !safeUser) return false;
      const normalizedUser = normalize(safeUser);
      const list = get().filteredByGroup[safeGroup] || [];
      return list.some((entry) => entry.normalized === normalizedUser);
    },
  })
);
