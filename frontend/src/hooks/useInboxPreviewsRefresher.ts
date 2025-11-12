import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { pythonApi } from "../services/api";
import { savePreview } from "../lib/previews";

type Preview = {
  threadId: string;
  username?: string;
  text?: string;
  kind?: string;
  timestamp?: string;
};

async function fetchInboxPreviews(): Promise<Preview[]> {
  const res = await pythonApi.get<{ previews: Preview[] }>("/inbox/previews", {
    timeout: 6000,
  });
  return Array.isArray(res.data?.previews) ? res.data.previews : [];
}

export function useInboxPreviewsRefresher(enabled: boolean) {
  const q = useQuery({
    queryKey: ["inboxPreviews"],
    queryFn: fetchInboxPreviews,
    enabled,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 5000,
  });

  useEffect(() => {
    if (!q.data || !Array.isArray(q.data)) return;
    for (const p of q.data) {
      try {
        if (p && p.threadId) void savePreview(p);
      } catch {}
    }
  }, [q.data]);

  return q;
}
