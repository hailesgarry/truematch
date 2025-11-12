import {
  useQuery,
  keepPreviousData,
  type QueryKey,
} from "@tanstack/react-query";
import { fetchLatestGroupMessages } from "../services/api";
import type { Message } from "../types";

export const GROUP_MESSAGES_DEFAULT_WINDOW = 200;
export const GROUP_MESSAGES_STALE_TIME_MS = 10_000;
export const GROUP_MESSAGES_GC_TIME_MS = 5 * 60_000;

export const messagesKey = (groupId: string): QueryKey => [
  "messages",
  "group",
  groupId,
];

type UseGroupMessagesOptions = {
  enabled?: boolean;
  count?: number;
};

const resolveOptions = (
  input?: boolean | UseGroupMessagesOptions
): UseGroupMessagesOptions => {
  if (typeof input === "boolean") {
    return { enabled: input };
  }
  return input ?? {};
};

export function useGroupMessagesQuery(
  groupId: string | undefined,
  enabledOrOptions?: boolean | UseGroupMessagesOptions
) {
  const gid = (groupId || "").trim();
  const options = resolveOptions(enabledOrOptions);
  const {
    enabled: enabledOption = true,
    count = GROUP_MESSAGES_DEFAULT_WINDOW,
  } = options;
  const canRun = enabledOption && !!gid;

  return useQuery<Message[], Error>({
    queryKey: messagesKey(gid),
    enabled: canRun,
    queryFn: ({ signal }) => fetchLatestGroupMessages(gid, { signal, count }),
    staleTime: GROUP_MESSAGES_STALE_TIME_MS,
    gcTime: GROUP_MESSAGES_GC_TIME_MS,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

export type { UseGroupMessagesOptions };

export default useGroupMessagesQuery;
