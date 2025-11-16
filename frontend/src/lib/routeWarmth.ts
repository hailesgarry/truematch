import { datingProfilesKey } from "../hooks/useDatingProfilesQuery";
import { isQueryFresh } from "./queryDiagnostics";

type RouteWarmthContext = {
  pathname: string;
  search?: string;
  state?: unknown;
};

export type RouteWarmthEvaluation =
  | { managed: true; warm: boolean }
  | { managed: false };

type RoutePolicy = {
  match: (ctx: RouteWarmthContext) => boolean;
  isWarm: (ctx: RouteWarmthContext) => boolean;
};

const policies: RoutePolicy[] = [
  {
    match: ({ pathname }) =>
      pathname === "/chat" || pathname.startsWith("/chat/"),
    isWarm: ({ pathname }) => {
      if (!pathname.startsWith("/chat/")) {
        return false;
      }
      const candidate = pathname.slice("/chat/".length);
      const nextSlash = candidate.indexOf("/");
      const roomSegment =
        nextSlash >= 0 ? candidate.slice(0, nextSlash) : candidate;
      if (!roomSegment) {
        return false;
      }
      let roomId = roomSegment;
      try {
        roomId = decodeURIComponent(roomSegment);
      } catch {
        roomId = roomSegment;
      }
      return isQueryFresh(["group", roomId], { staleTime: 60_000 });
    },
  },
  {
    match: ({ pathname }) => pathname === "/dating",
    isWarm: () => {
      return isQueryFresh(datingProfilesKey, {
        staleTime: 5 * 60_000,
      });
    },
  },
];

export function evaluateRouteWarmth(
  ctx: RouteWarmthContext
): RouteWarmthEvaluation {
  if (!ctx.pathname) {
    return { managed: false };
  }
  for (const policy of policies) {
    if (!policy.match(ctx)) {
      continue;
    }
    try {
      return { managed: true, warm: policy.isWarm(ctx) };
    } catch {
      return { managed: true, warm: false };
    }
  }
  return { managed: false };
}
