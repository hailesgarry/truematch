import { useEffect, useRef } from "react";
import { focusManager, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DatingProfile } from "../types";
import { fetchDatingProfiles } from "../services/api";
import { useBroadcastChannel } from "./useBroadcastChannel";
import { broadcastMessage } from "../lib/broadcast";

export function useDatingProfilesQuery(enabled: boolean = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;

    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (hiddenTimer !== null) {
          clearTimeout(hiddenTimer);
          hiddenTimer = null;
        }
        focusManager.setFocused(true);
        return;
      }

      if (hiddenTimer !== null) {
        clearTimeout(hiddenTimer);
      }
      hiddenTimer = setTimeout(() => {
        focusManager.setFocused(false);
      }, 60_000);
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (hiddenTimer !== null) {
        clearTimeout(hiddenTimer);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const query = useQuery<DatingProfile[], Error>({
    queryKey: datingProfilesKey,
    enabled,
    queryFn: async () => {
      try {
        return await fetchDatingProfiles({ timeoutMs: 7000 });
      } catch (e: any) {
        if (e?.code === "ECONNABORTED") {
          return await fetchDatingProfiles({ timeoutMs: 12000 });
        }
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: 2,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 180_000,
    refetchIntervalInBackground: true,
  });

  const lastBroadcastRef = useRef(0);

  useEffect(() => {
    if (!query.isSuccess || query.isFetching) {
      return;
    }
    const updatedAt = query.dataUpdatedAt || Date.now();
    if (updatedAt <= lastBroadcastRef.current) {
      return;
    }
    lastBroadcastRef.current = updatedAt;
    broadcastMessage("tm:dating", {
      type: "dating:refetched",
    });
  }, [query.isSuccess, query.isFetching, query.dataUpdatedAt]);

  useBroadcastChannel<
    { type: "dating:refetched" } | { type: "dating:invalidate" }
  >("tm:dating", (payload) => {
    if (payload.type === "dating:refetched") {
      queryClient.invalidateQueries({
        queryKey: datingProfilesKey,
        exact: true,
      });
      return;
    }
    if (payload.type === "dating:invalidate") {
      queryClient.invalidateQueries({ queryKey: datingProfilesKey });
    }
  });

  return query;
}

export default useDatingProfilesQuery;

// Shared query key for dating profiles (used in prefetch and mutations)
export const datingProfilesKey = ["dating", "profiles"] as const;
