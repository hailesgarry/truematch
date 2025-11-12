import { useQuery } from "@tanstack/react-query";
import { API_URL } from "../services/api";

export type LinkPreviewData = {
  url: string;
  finalUrl?: string;
  title?: string;
  description?: string;
  siteName?: string;
  favicon?: string;
  image?: string;
};

function buildLinkPreviewUrl(rawUrl: string): string {
  const base = (API_URL || "").trim();
  if (!base) {
    return `/api/link-preview?url=${encodeURIComponent(rawUrl)}`;
  }

  const normalizedBase = base.replace(/\/+$/u, "");
  return `${normalizedBase}/link-preview?url=${encodeURIComponent(rawUrl)}`;
}

async function fetchPreview(url: string): Promise<LinkPreviewData | null> {
  const endpoint = buildLinkPreviewUrl(url);
  const response = await fetch(endpoint);
  if (response.status === 204) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load link preview (${response.status})`);
  }
  const json = (await response.json()) as LinkPreviewData;
  return json;
}

type UseLinkPreviewOptions = {
  enabled?: boolean;
};

export function useLinkPreview(
  url?: string | null,
  options?: UseLinkPreviewOptions
) {
  return useQuery<LinkPreviewData | null>({
    queryKey: ["link-preview", url],
    queryFn: () => fetchPreview(url as string),
    enabled: Boolean(url) && (options?.enabled ?? true),
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });
}
