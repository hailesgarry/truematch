import { useQuery } from "@tanstack/react-query";
import { fetchMyProfile } from "../services/api";
import type { UserProfile } from "../services/api";
import { useAuthStore } from "../stores/authStore";

export const currentProfileKey = ["profile", "me"];

export function useCurrentProfile(enabled: boolean = true) {
  const { token } = useAuthStore();
  const q = useQuery<UserProfile, Error>({
    queryKey: currentProfileKey,
    queryFn: () => {
      if (!token) throw new Error("No auth token");
      return fetchMyProfile(token);
    },
    enabled: enabled && !!token,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  // Optional manual refresh bridging
  return { ...q, profile: q.data || null };
}
