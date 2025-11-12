import { QueryClient } from "@tanstack/react-query";

// Singleton QueryClient with performance-minded defaults
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache for 5 minutes, consider fresh for 60s
      gcTime: 5 * 60 * 1000,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 2,
    },
    mutations: {
      // Don't block render for mutations
      networkMode: "online",
    },
  },
});

export default queryClient;
