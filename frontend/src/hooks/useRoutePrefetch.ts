import { useMemo, useRef, useCallback, type HTMLAttributes } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { preloadRoute, prefetchData } from "../utils/prefetch";

export type RoutePrefetchHandlers = Pick<
  HTMLAttributes<HTMLElement>,
  "onMouseEnter" | "onFocus" | "onTouchStart"
>;

export function useRoutePrefetch(path: string): RoutePrefetchHandlers {
  const qc = useQueryClient();
  const hasPrefetched = useRef(false);

  const trigger = useCallback(() => {
    if (!path) return;
    preloadRoute(path);
    void prefetchData(qc, path);

    if (hasPrefetched.current) return;
    hasPrefetched.current = true;
  }, [path, qc]);

  return useMemo(
    () => ({
      onMouseEnter: trigger,
      onFocus: trigger,
      onTouchStart: trigger,
    }),
    [trigger]
  );
}

export default useRoutePrefetch;
