import { Suspense, useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { useAuthStore } from "./stores/authStore";
import { useSocketStore } from "./stores/socketStore";
import queryClient from "./lib/queryClient";
import { groupsKey } from "./hooks/useGroupsQuery";
import { datingProfilesKey } from "./hooks/useDatingProfilesQuery";
import {
  fetchGroups,
  fetchDatingProfiles,
  fetchDatingProfile,
} from "./services/api";

const routerFallback = (
  <div className="flex h-screen w-full items-center justify-center text-sm text-slate-500">
    Loading application...
  </div>
);

function App() {
  const { token, needsMigration } = useAuthStore();
  const connect = useSocketStore((s) => s.connect);
  const disconnect = useSocketStore((s) => s.disconnect);

  useEffect(() => {
    if (token && !needsMigration) {
      // Defer socket connection to avoid blocking initial render
      setTimeout(() => {
        connect();
        // Prefetch common data after connection
        setTimeout(() => {
          const auth = useAuthStore.getState();
          if (auth.username) {
            // Prefetch groups
            queryClient.prefetchQuery({
              queryKey: groupsKey,
              queryFn: () => fetchGroups(false),
              staleTime: 5 * 60 * 1000,
            });
          }
          if (auth.userId) {
            // Prefetch dating profiles
            queryClient.prefetchQuery({
              queryKey: datingProfilesKey,
              queryFn: () => fetchDatingProfiles(),
              staleTime: 5 * 60 * 1000,
            });
            // Prefetch current user's dating profile
            queryClient.prefetchQuery({
              queryKey: ["datingProfile", auth.userId],
              queryFn: () => fetchDatingProfile({ userId: auth.userId }),
              staleTime: 5 * 60 * 1000,
            });
          }
        }, 500); // Wait a bit after connect
      }, 100);
    } else {
      disconnect();
    }
    return () => {
      disconnect();
    };
  }, [token, needsMigration, connect, disconnect]);

  return (
    <Suspense fallback={routerFallback} hydrateFallback={routerFallback}>
      <RouterProvider router={router} />
    </Suspense>
  );
}

export default App;
