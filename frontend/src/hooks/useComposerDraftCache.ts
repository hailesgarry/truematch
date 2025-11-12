import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const STORAGE_PREFIX = "composerDraft:";

type DraftSnapshot = {
  text: string;
  cursorPos: number;
};

const EMPTY_SNAPSHOT: DraftSnapshot = {
  text: "",
  cursorPos: 0,
};

function loadSnapshot(scopeKey: string): DraftSnapshot {
  if (typeof window === "undefined") return EMPTY_SNAPSHOT;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${scopeKey}`);
    if (!raw) return EMPTY_SNAPSHOT;
    const parsed = JSON.parse(raw) as Partial<DraftSnapshot>;
    if (typeof parsed?.text === "string") {
      const pos = typeof parsed.cursorPos === "number" ? parsed.cursorPos : 0;
      const clampedPos = Math.max(0, Math.min(pos, parsed.text.length));
      return {
        text: parsed.text,
        cursorPos: clampedPos,
      };
    }
  } catch {
    // ignore malformed storage entries
  }
  return EMPTY_SNAPSHOT;
}

function persistSnapshot(scopeKey: string, snapshot: DraftSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${scopeKey}`,
      JSON.stringify(snapshot)
    );
  } catch {
    // Swallow storage write failures (quota, privacy mode, etc.)
  }
}

export function useComposerDraftCache(
  scopeKey: string | null | undefined,
  draft: string,
  cursorPos: number,
  setDraft: (text: string, cursorPos?: number) => void
): void {
  const queryClient = useQueryClient();
  const lastSavedRef = useRef<{
    scope: string | null;
    text: string;
    cursor: number;
  }>({ scope: null, text: "", cursor: 0 });
  const hydratedRef = useRef<Map<string, DraftSnapshot>>(new Map());

  const queryKey = scopeKey
    ? ["composerDraft", scopeKey]
    : ["composerDraft", "__null__"];

  const { data } = useQuery<DraftSnapshot>({
    queryKey,
    queryFn: async () => {
      if (!scopeKey) return EMPTY_SNAPSHOT;
      return loadSnapshot(scopeKey);
    },
    initialData: () => {
      if (!scopeKey) return EMPTY_SNAPSHOT;
      return loadSnapshot(scopeKey);
    },
    enabled: Boolean(scopeKey),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (!scopeKey || !data) return;
    const normalizedCursor = Math.max(
      0,
      Math.min(
        typeof data.cursorPos === "number" ? data.cursorPos : 0,
        data.text.length
      )
    );
    const incoming: DraftSnapshot = {
      text: data.text,
      cursorPos: normalizedCursor,
    };

    const hydratedSnapshot = hydratedRef.current.get(scopeKey);
    const alreadyHydrated =
      hydratedSnapshot?.text === incoming.text &&
      hydratedSnapshot?.cursorPos === incoming.cursorPos;

    if (alreadyHydrated) return;

    if (draft === incoming.text && cursorPos === incoming.cursorPos) {
      hydratedRef.current.set(scopeKey, incoming);
      return;
    }

    hydratedRef.current.set(scopeKey, incoming);
    setDraft(incoming.text, incoming.cursorPos);
  }, [scopeKey, data?.text, data?.cursorPos, draft, cursorPos, setDraft, data]);

  useEffect(() => {
    if (!scopeKey) return;
    const snapshot: DraftSnapshot = {
      text: draft,
      cursorPos: Math.max(0, Math.min(cursorPos, draft.length)),
    };

    const lastSaved = lastSavedRef.current;
    if (
      lastSaved.scope === scopeKey &&
      lastSaved.text === snapshot.text &&
      lastSaved.cursor === snapshot.cursorPos
    ) {
      return;
    }

    const hydratedSnapshot = hydratedRef.current.get(scopeKey);
    if (
      !hydratedSnapshot ||
      hydratedSnapshot.text !== snapshot.text ||
      hydratedSnapshot.cursorPos !== snapshot.cursorPos
    ) {
      hydratedRef.current.set(scopeKey, snapshot);
    }

    queryClient.setQueryData<DraftSnapshot>(
      ["composerDraft", scopeKey],
      snapshot
    );
    persistSnapshot(scopeKey, snapshot);
    lastSavedRef.current = {
      scope: scopeKey,
      text: snapshot.text,
      cursor: snapshot.cursorPos,
    };
  }, [scopeKey, draft, cursorPos, queryClient]);
}
