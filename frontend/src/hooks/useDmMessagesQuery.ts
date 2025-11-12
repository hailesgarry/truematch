import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useMessageStore } from "../stores/messageStore";
import type { Message } from "../types";

export const dmMessagesKey = (dmId: string) => ["dm", "messages", dmId];

export function useDmMessagesQuery(
  dmId?: string | null,
  enabled: boolean = true
) {
  const store = useMessageStore();
  return useQuery<Message[]>({
    queryKey: dmMessagesKey(dmId || ""),
    queryFn: async () => {
      if (!dmId) return [] as Message[];
      // Return current store snapshot; sockets will keep it fresh
      const list = store.messages[dmId] || [];
      return list;
    },
    enabled: enabled && !!dmId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: keepPreviousData,
  });
}
