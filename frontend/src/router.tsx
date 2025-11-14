import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  Outlet,
  ScrollRestoration,
  createBrowserRouter,
  isRouteErrorResponse,
  redirect,
  useLocation,
  useNavigation,
  useRouteError,
  type LoaderFunctionArgs,
} from "react-router-dom";
import { useUiStore } from "./stores/uiStore";
import { useAuthStore } from "./stores/authStore";
import queryClient from "./lib/queryClient";
import { ensureQueryDataWithDiagnostics } from "./lib/queryDiagnostics";
import { currentProfileKey } from "./hooks/useCurrentProfile";
import { fetchMyProfile, fetchGroupById } from "./services/api";
import type { UserProfile } from "./services/api";
import type { Group } from "./types";
import { useGroupStore } from "./stores/groupStore";
import { loadChatPage, preloadChatPage } from "./utils/preloadModules";
import {
  evaluateRouteWarmth,
  type RouteWarmthEvaluation,
} from "./lib/routeWarmth";
import RouteProgress from "./components/common/RouteProgress";

const ROUTE_DATA_SOFT_TIMEOUT_MS = 1000;

async function withSoftTimeout<T>(
  promise: Promise<T>,
  fallback: () => T,
  label: string,
  timeoutMs = ROUTE_DATA_SOFT_TIMEOUT_MS
): Promise<{ value: T; didFallback: boolean }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(fallback());
    }, timeoutMs);
  });

  let value: T;
  try {
    value = await Promise.race([promise, timeoutPromise]);
  } catch (error) {
    if (timer !== null) {
      clearTimeout(timer);
    }
    console.warn(
      `[RouteData] ${label}: loader failed, using cached fallback`,
      error
    );
    return { value: fallback(), didFallback: true };
  }

  if (timer !== null) {
    clearTimeout(timer);
  }

  if (timedOut) {
    if (timeoutMs > 0) {
      console.warn(
        `[RouteData] ${label}: continuing with cached data after ${timeoutMs}ms soft timeout`
      );
    }
    promise
      .then(() => {
        /* background completion */
      })
      .catch((error) => {
        console.warn(
          `[RouteData] ${label}: background fetch failed after timeout`,
          error
        );
      });
  }

  return { value, didFallback: timedOut };
}

const LoginPage = lazy(() => import("./pages/LoginPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const LegacyMigratePage = lazy(() => import("./pages/LegacyMigratePage"));
const AppShell = lazy(() => import("./layout/AppShell"));
const HomePage = lazy(() => import("./pages/Home"));
const CreateRoomPage = lazy(() => import("./pages/CreateRoomPage"));
const ChatPage = lazy(() => loadChatPage());
const MatchesPage = lazy(() => import("./pages/MatchesPage"));
const LikedMePage = lazy(() => import("./pages/LikedMePage"));
const DirectMessages = lazy(() => import("./pages/DirectMessages"));
const PrivateChatPage = lazy(() => import("./pages/PrivateChatPage"));
const DatingPage = lazy(() => import("./pages/DatingPage"));
const NotificationPage = lazy(() => import("./pages/NotificationPage"));
const DatingProfilePage = lazy(() => import("./pages/DatingProfilePage"));
const CreateDatingProfile = lazy(() => import("./pages/CreateDatingProfile"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const EditProfilePage = lazy(() => import("./pages/EditProfilePage"));
const EditDatingProfilePage = lazy(
  () => import("./pages/edit-dating-profile/Profile")
);
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const LogoDownloadPage = lazy(() => import("./pages/LogoDownloadPage.tsx"));

type PendingRouteState = {
  pendingRouteLoading?: boolean;
  loadingMessage?: string;
};

const wantsRouteLoading = (
  state: PendingRouteState | null | undefined,
  evaluation?: RouteWarmthEvaluation
) => {
  if (state && typeof state.pendingRouteLoading === "boolean") {
    return state.pendingRouteLoading;
  }
  if (evaluation && evaluation.managed) {
    return !evaluation.warm;
  }
  return false;
};

const LOGIN_PATH = "/login";
const SIGNUP_PATH = "/signup";
const MIGRATE_PATH = "/migrate";
const FIRST_VISIT_KEY = "firstVisit";

// Shared no-op loader so speculative fetches never surface a 404.
const noopLoader = () => null;

function RouterHydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center text-sm text-slate-500">
      Loading application...
    </div>
  );
}

function PageSuspense({ children }: { children: ReactNode }) {
  const fallback = null;
  return (
    <Suspense fallback={fallback} hydrateFallback={fallback}>
      {children}
    </Suspense>
  );
}

function RouteLoadingManager() {
  const navigation = useNavigation();
  const location = useLocation();
  const loadingRef = useRef(false);
  const manualMessageRef = useRef<string | undefined>(undefined);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLocationKeyRef = useRef(location.key);
  const isInitialRender = useRef(true);

  const dispatchStartRouteLoading = useCallback((message?: string) => {
    useUiStore.getState().startRouteLoading(message);
  }, []);

  const dispatchFinishRouteLoading = useCallback((delay?: number) => {
    useUiStore.getState().finishRouteLoading(delay);
  }, []);

  const clearScheduledStop = useCallback(() => {
    if (stopTimerRef.current !== null) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
      loadingRef.current = false;
      manualMessageRef.current = undefined;
    }
  }, []);

  const startLoading = useCallback(
    (message?: string) => {
      clearScheduledStop();

      if (!loadingRef.current) {
        loadingRef.current = true;
        manualMessageRef.current = message;
        dispatchStartRouteLoading(message);
        return;
      }

      const currentMessage = manualMessageRef.current;
      if (message !== undefined && message !== currentMessage) {
        manualMessageRef.current = message;
        dispatchStartRouteLoading(message);
      } else if (message === undefined && currentMessage !== undefined) {
        manualMessageRef.current = undefined;
        dispatchStartRouteLoading(undefined);
      }
    },
    [clearScheduledStop, dispatchStartRouteLoading]
  );

  const stopLoading = useCallback(
    (delay = 160) => {
      if (!loadingRef.current) return;

      clearScheduledStop();
      dispatchFinishRouteLoading(delay);
      stopTimerRef.current = setTimeout(() => {
        loadingRef.current = false;
        manualMessageRef.current = undefined;
        stopTimerRef.current = null;
      }, delay);
    },
    [clearScheduledStop, dispatchFinishRouteLoading]
  );

  useEffect(() => {
    const busy =
      navigation.state === "loading" || navigation.state === "submitting";
    const pendingPathname = navigation.location?.pathname ?? location.pathname;
    const pending = navigation.location?.state as PendingRouteState | undefined;
    const evaluation = evaluateRouteWarmth({
      pathname: pendingPathname,
      search: navigation.location?.search ?? "",
      state: pending,
    });
    const shouldHandle =
      evaluation.managed || typeof pending?.pendingRouteLoading === "boolean";

    if (busy) {
      if (!shouldHandle || !wantsRouteLoading(pending, evaluation)) {
        if (loadingRef.current) {
          stopLoading(0);
        }
        return;
      }
      const message =
        pending?.pendingRouteLoading && pending.loadingMessage
          ? pending.loadingMessage
          : undefined;

      startLoading(message);
    } else if (loadingRef.current) {
      stopLoading(160);
    }
  }, [
    navigation.state,
    navigation.location,
    startLoading,
    stopLoading,
    location.pathname,
  ]);

  useEffect(() => {
    if (!loadingRef.current) {
      return;
    }
    const pending = (location.state as PendingRouteState | null) ?? null;
    const evaluation = evaluateRouteWarmth({
      pathname: location.pathname,
      search: location.search ?? "",
      state: pending,
    });
    if (!wantsRouteLoading(pending, evaluation)) {
      if (loadingRef.current) {
        stopLoading(0);
      }
      return;
    }
    if (pending?.pendingRouteLoading && pending.loadingMessage) {
      startLoading(pending.loadingMessage);
    }
  }, [
    location.key,
    location.state,
    location.pathname,
    location.search,
    startLoading,
  ]);

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      prevLocationKeyRef.current = location.key;
      return;
    }

    if (prevLocationKeyRef.current === location.key) {
      return;
    }

    prevLocationKeyRef.current = location.key;

    if (loadingRef.current) {
      return;
    }

    const pending = (location.state as PendingRouteState | null) ?? null;
    const evaluation = evaluateRouteWarmth({
      pathname: location.pathname,
      search: location.search ?? "",
      state: pending,
    });

    if (!wantsRouteLoading(pending, evaluation)) {
      return;
    }
    const message =
      pending?.pendingRouteLoading && pending.loadingMessage
        ? pending.loadingMessage
        : undefined;

    startLoading(message);
    stopLoading(160);
  }, [
    location.key,
    location.state,
    location.pathname,
    location.search,
    startLoading,
    stopLoading,
  ]);

  useEffect(() => {
    return () => {
      clearScheduledStop();
      if (loadingRef.current) {
        loadingRef.current = false;
        manualMessageRef.current = undefined;
        dispatchFinishRouteLoading(0);
      }
    };
  }, [clearScheduledStop, dispatchFinishRouteLoading]);

  return null;
}

function RootLayout() {
  return (
    <>
      <RouteProgress />
      <RouteLoadingManager />
      <ScrollRestoration />
      <PageSuspense>
        <Outlet />
      </PageSuspense>
    </>
  );
}

function RootErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const message = isRouteErrorResponse(error)
    ? error.statusText || "Unexpected error"
    : error instanceof Error
    ? error.message
    : "Something went wrong";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
      <div className="text-3xl font-semibold text-slate-800">{status}</div>
      <p className="max-w-md text-sm text-slate-600">{message}</p>
      <a
        href="/"
        className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-700"
      >
        Back to safety
      </a>
    </div>
  );
}

async function ensureAuthHydrated(timeoutMs = 1500): Promise<void> {
  if (typeof window === "undefined") return;
  const start = Date.now();
  while (!useAuthStore.getState().hydrated && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

async function protectedLoader(): Promise<{ viewer: UserProfile }> {
  await ensureAuthHydrated(400);
  const auth = useAuthStore.getState();

  if (auth.needsMigration) {
    throw redirect(MIGRATE_PATH);
  }

  if (!auth.joined || !auth.token) {
    if (typeof window !== "undefined") {
      try {
        if (localStorage.getItem(FIRST_VISIT_KEY) === null) {
          localStorage.setItem(FIRST_VISIT_KEY, "1");
          throw redirect(SIGNUP_PATH);
        }
      } catch {
        /* no-op */
      }
    }
    throw redirect(LOGIN_PATH);
  }

  const cachedViewer =
    queryClient.getQueryData<UserProfile>(currentProfileKey) ?? null;

  const fallbackViewer: UserProfile =
    cachedViewer ??
    ({
      userId: auth.userId ?? "",
      username: auth.username ?? "",
      avatarUrl: auth.avatar ?? null,
      friends: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies UserProfile);

  queryClient.setQueryData(currentProfileKey, fallbackViewer);

  void queryClient
    .fetchQuery({
      queryKey: currentProfileKey,
      queryFn: () => fetchMyProfile(auth.token as string),
      staleTime: 60_000,
    })
    .catch((error) => {
      console.warn(
        "[RouteData] protectedLoader: background refresh failed",
        error
      );
    });

  return { viewer: fallbackViewer };
}

async function publicOnlyLoader(): Promise<null> {
  await ensureAuthHydrated();
  const auth = useAuthStore.getState();

  if (auth.needsMigration) {
    throw redirect(MIGRATE_PATH);
  }

  if (auth.joined && auth.token) {
    throw redirect("/");
  }

  return null;
}

async function migrationLoader(): Promise<null> {
  await ensureAuthHydrated();
  const { needsMigration } = useAuthStore.getState();
  if (!needsMigration) {
    throw redirect("/");
  }
  return null;
}

async function chatLoader({ params }: LoaderFunctionArgs) {
  await ensureAuthHydrated(400);
  preloadChatPage();

  const raw = params?.roomId ?? "";
  const roomId = typeof raw === "string" ? raw.trim() : String(raw).trim();

  if (!roomId) {
    throw redirect("/");
  }

  const store = useGroupStore.getState();
  const existing =
    store.groups.find((g) => g.id === roomId) ||
    (store.currentGroup && store.currentGroup.id === roomId
      ? store.currentGroup
      : null);

  const fallbackGroup: Group = existing ?? {
    id: roomId,
    databaseId: roomId,
    name: "Loading…",
    description: "Preparing chat…",
  };

  useGroupStore.setState((state) => {
    if (state.currentGroup?.id === fallbackGroup.id) {
      return {};
    }
    return { currentGroup: fallbackGroup };
  });

  const fetchPromise = ensureQueryDataWithDiagnostics<Group>(
    {
      queryKey: ["group", roomId],
      queryFn: () => fetchGroupById(roomId),
      staleTime: 60_000,
    },
    { loader: "chatLoader", resource: `group:${roomId}` }
  ).then((fresh) => {
    useGroupStore.setState((state) => {
      const inList = state.groups.some((g) => g.id === fresh.id);
      return {
        currentGroup: fresh,
        groups: inList ? state.groups : [...state.groups, fresh],
      };
    });
    return fresh;
  });

  const { value: group } = await withSoftTimeout(
    fetchPromise,
    () => fallbackGroup,
    `chatLoader:${roomId}`
  );

  return { roomId, group };
}

const router = createBrowserRouter([
  {
    id: "root",
    element: <RootLayout />,
    errorElement: <RootErrorBoundary />,
    HydrateFallback: RouterHydrateFallback,
    children: [
      {
        path: LOGIN_PATH,
        loader: publicOnlyLoader,
        element: (
          <PageSuspense>
            <LoginPage />
          </PageSuspense>
        ),
      },
      {
        path: SIGNUP_PATH,
        loader: publicOnlyLoader,
        element: (
          <PageSuspense>
            <SignupPage />
          </PageSuspense>
        ),
      },
      {
        path: MIGRATE_PATH,
        loader: migrationLoader,
        element: (
          <PageSuspense>
            <LegacyMigratePage />
          </PageSuspense>
        ),
      },
      {
        path: "/",
        id: "app-shell",
        loader: protectedLoader,
        HydrateFallback: RouterHydrateFallback,
        element: (
          <PageSuspense>
            <AppShell />
          </PageSuspense>
        ),
        children: [
          {
            index: true,
            element: (
              <PageSuspense>
                <HomePage />
              </PageSuspense>
            ),
          },
          {
            path: "create-room",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <CreateRoomPage />
              </PageSuspense>
            ),
          },
          {
            path: "chat/:roomId",
            loader: chatLoader,
            element: (
              <PageSuspense>
                <ChatPage />
              </PageSuspense>
            ),
          },
          {
            path: "matches",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <MatchesPage />
              </PageSuspense>
            ),
          },
          {
            path: "matches/liked-me/:username",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <LikedMePage />
              </PageSuspense>
            ),
          },
          {
            path: "direct",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <DirectMessages />
              </PageSuspense>
            ),
          },
          {
            path: "dm/:userId",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <PrivateChatPage />
              </PageSuspense>
            ),
          },
          {
            path: "dating",
            element: (
              <PageSuspense>
                <DatingPage />
              </PageSuspense>
            ),
          },
          {
            path: "inbox",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <NotificationPage />
              </PageSuspense>
            ),
          },
          {
            path: "dating-profile/:userId",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <DatingProfilePage />
              </PageSuspense>
            ),
          },
          {
            path: "dating-profile/create",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <CreateDatingProfile />
              </PageSuspense>
            ),
          },
          {
            path: "edit-dating-profile/profile/:userId",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <EditDatingProfilePage />
              </PageSuspense>
            ),
          },
          {
            path: "onboarding",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <OnboardingPage />
              </PageSuspense>
            ),
          },
          {
            path: "edit-profile/:userId",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <EditProfilePage />
              </PageSuspense>
            ),
          },
          {
            path: "profile/:userId",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <ProfilePage />
              </PageSuspense>
            ),
          },
          {
            path: "logos",
            loader: noopLoader,
            element: (
              <PageSuspense>
                <LogoDownloadPage />
              </PageSuspense>
            ),
          },
        ],
      },
      {
        path: "*",
        loader: () => redirect("/"),
      },
    ],
  },
]);

export { router };
