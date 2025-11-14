import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLikesReceived, type LikeSummary } from "../services/api";
import { useLikesStore } from "../stores/likesStore";
import { useAuthStore } from "../stores/authStore";

type SyncOptions = {
  enabled?: boolean;
  refetchIntervalMs?: number;
};

const DEFAULT_INTERVAL = 30_000;

const mapIncoming = (items: LikeSummary[] | undefined) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const userId = typeof item?.userId === "string" ? item.userId : "";
      const rawUsername =
        typeof item?.username === "string" ? item.username : "";
      const username = rawUsername || userId;
      if (!username) return null;
      return {
        userId,
        username,
        displayName:
          typeof item?.name === "string" ? item.name : rawUsername || null,
        avatar:
          typeof item?.profileAvatar === "string"
            ? item.profileAvatar
            : typeof item?.avatar === "string"
            ? item.avatar
            : null,
        profileAvatar:
          typeof item?.profileAvatar === "string"
            ? item.profileAvatar
            : typeof item?.avatar === "string"
            ? item.avatar
            : null,
        datingPhoto:
          typeof item?.datingPhoto === "string" ? item.datingPhoto : null,
        datingPhotos: Array.isArray(item?.datingPhotos)
          ? item.datingPhotos.filter(
              (value): value is string => typeof value === "string"
            )
          : null,
        hasDatingProfile:
          typeof item?.hasDatingProfile === "boolean"
            ? item.hasDatingProfile
            : null,
        at: Number(item?.likedAt) || Date.now(),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
};

export function useDatingLikesSync(
  username: string | null | undefined,
  options?: SyncOptions
) {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.userId);
  const normalized = useMemo(() => {
    if (typeof username !== "string") return "";
    const trimmed = username.trim();
    return trimmed.toLowerCase();
  }, [username]);

  const authReady =
    Boolean(token && (userId || normalized)) && (options?.enabled ?? true);
  const refetchInterval = options?.refetchIntervalMs ?? DEFAULT_INTERVAL;

  const incomingQuery = useQuery({
    queryKey: ["likes", "incoming", userId || normalized],
    queryFn: () => fetchLikesReceived(token!),
    enabled: authReady,
    refetchInterval: authReady ? refetchInterval : false,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!authReady) return;
    if (!incomingQuery.isSuccess) return;
    const incoming = mapIncoming(incomingQuery.data);
    useLikesStore.getState().replaceIncoming(incoming);
  }, [authReady, incomingQuery.isSuccess, incomingQuery.data]);

  return { incomingQuery };
}
