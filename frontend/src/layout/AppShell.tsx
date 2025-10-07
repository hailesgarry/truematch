import React, { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChatCircleDots, SignOut, UserGear, Heartbeat } from "phosphor-react";
import Header from "../components/layout/Header";
import BottomNav from "../components/layout/BottomNav";
import Drawer from "../components/common/Drawer";
import { useAuthStore } from "../stores/authStore";
import { fetchDatingProfile } from "../services/api";
import { useQuery } from "@tanstack/react-query";
import { useDatingStore } from "../stores/datingStore";

const AppShell: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { username, avatar, logout } = useAuthStore();

  // Drawer
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const pathname = location.pathname;

  // UPDATED: hide rules
  // - Hide Header on: /, /direct, /inbox, /chat, /dm/:peer, /edit-profile, /chat-settings, /dating-profile, /edit-dating-profile, /active-members, /u/:id, /profile, /emoji-picker, /gif-picker
  // - Hide BottomNav on: /, /chat, /dm/:peer, /edit-profile, /chat-settings, /dating-profile, /edit-dating-profile, /active-members, /u/:id, /profile, /emoji-picker, /gif-picker
  const hideHeader =
    /^\/(?:$|direct(?:\/|$)|inbox(?:\/|$)|chat(?:\/|$)|dm\/|edit-profile(?:\/|$)|chat-settings(?:\/|$)|dating-profile(?:\/|$)|edit-dating-profile(?:\/|$)|active-members(?:\/|$)|u\/|profile(?:\/|$)|emoji-picker(?:\/|$)|gif-picker(?:\/|$))/.test(
      pathname
    );
  const hideBottomNav =
    /^\/(?:$|chat(?:\/|$)|dm\/|edit-profile(?:\/|$)|chat-settings(?:\/|$)|dating-profile(?:\/|$)|edit-dating-profile(?:\/|$)|active-members(?:\/|$)|u\/|profile(?:\/|$)|emoji-picker(?:\/|$)|gif-picker(?:\/|$))/.test(
      pathname
    );

  const showHeader = !hideHeader;
  const showBottomNav = !hideBottomNav;

  // Keep Direct active for both /direct and /dm/:peer
  const activeTab = useMemo<"home" | "dating" | "direct" | "inbox">(() => {
    if (pathname.startsWith("/dating")) return "dating";
    if (pathname.startsWith("/direct")) return "direct";
    if (pathname.startsWith("/dm/")) return "direct";
    if (pathname.startsWith("/inbox")) return "inbox";
    return "home";
  }, [pathname]);

  // Reactively derive dating profile presence using server truth with local fallback
  const { data: serverProfile } = useQuery({
    queryKey: ["datingProfile", username],
    queryFn: () => fetchDatingProfile(String(username)),
    enabled: !!username,
    // we want fresh server truth when others update it; defaults are fine
  });
  const localProfile = useDatingStore((s) => s.profile);
  const effectiveHasProfile = useMemo(() => {
    // Server truth if known (null means definitively no profile)
    if (serverProfile !== undefined) {
      if (serverProfile === null) return false;
      const p: any = serverProfile;
      return Boolean(
        p?.photoUrl ||
          (Array.isArray(p?.photos) && p.photos.length > 0) ||
          p?.mood ||
          typeof p?.age === "number" ||
          p?.gender ||
          p?.religion
      );
    }
    // Fallback to optimistic local state while server loads
    return Boolean(localProfile?.photo || (localProfile as any)?.mood);
  }, [serverProfile, localProfile]);

  // Close drawer automatically on route change to avoid race with navigation
  useEffect(() => {
    if (isDrawerOpen) setIsDrawerOpen(false);
  }, [pathname]);

  // Back-compat: clear any old session flags (no longer needed)
  useEffect(() => {
    try {
      if (sessionStorage.getItem("datingProfileDeleted") === "1") {
        sessionStorage.removeItem("datingProfileDeleted");
      }
      if (sessionStorage.getItem("datingProfileCreated") === "1") {
        sessionStorage.removeItem("datingProfileCreated");
      }
    } catch {}
  }, [pathname]);

  const whiteBg = /^\/(?:u\/|profile(?:\/|$))/.test(pathname);

  return (
    <div
      className={`flex flex-col min-h-screen ${
        whiteBg ? "bg-white" : "bg-gray-50"
      }`}
    >
      {showHeader && <Header onAvatarClick={() => setIsDrawerOpen(true)} />}

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        position="right"
        width="280px"
      >
        <div className="flex flex-col h-full">
          <div className="flex flex-col items-center justify-start py-4 pb-2">
            {avatar ? (
              <img
                src={avatar}
                alt={(username || "User") + " avatar"}
                className="w-20 h-20 rounded-full mb-2 cursor-pointer"
                onClick={() => {
                  setIsDrawerOpen(false);
                  navigate("/profile");
                }}
              />
            ) : (
              <div
                className="w-20 h-20 rounded-full bg-gray-200 mb-2 cursor-pointer"
                onClick={() => {
                  setIsDrawerOpen(false);
                  navigate("/profile");
                }}
              />
            )}
            <p
              className="text-lg font-medium text-gray-900 cursor-pointer"
              onClick={() => {
                setIsDrawerOpen(false);
                navigate("/profile");
              }}
            >
              {username}
            </p>
          </div>

          <div className="pt-2 border-t border-gray-200">
            <ul className="space-y-2">
              <li>
                <button
                  className="w-full flex items-center py-3 px-4"
                  onClick={() => {
                    navigate("/edit-profile");
                  }}
                >
                  <UserGear size={22} className="mr-3 text-gray-900" />
                  <span className="text-sm font-medium">Edit profile</span>
                </button>
              </li>
              <li>
                <button
                  className="w-full flex items-center py-3 px-4"
                  onClick={() => {
                    navigate(
                      effectiveHasProfile
                        ? "/edit-dating-profile"
                        : "/dating-profile"
                    );
                  }}
                >
                  <Heartbeat size={22} className="mr-3 text-gray-900" />
                  <span className="text-sm font-medium">
                    {effectiveHasProfile
                      ? "Edit dating profile"
                      : "Dating profile"}
                  </span>
                </button>
              </li>
              <li>
                <button
                  className="w-full flex items-center py-3 px-4"
                  onClick={() => {
                    navigate("/chat-settings");
                  }}
                >
                  <ChatCircleDots size={22} className="mr-3 text-gray-900" />
                  <span className="text-sm font-medium">Chat settings</span>
                </button>
              </li>
            </ul>
          </div>

          <div className="mt-auto border-t border-gray-200 pt-2 pb-16">
            <button
              className="w-full flex items-center py-3 px-4 text-red-600"
              onClick={() => {
                logout();
                setIsDrawerOpen(false);
                navigate("/", { replace: true });
              }}
            >
              <SignOut size={22} className="mr-3" />
              <span className="text-sm font-medium">Sign Out</span>
            </button>
          </div>
        </div>
      </Drawer>

      {/* Only pad when BottomNav is visible */}
      <div className={`flex-1 min-h-0 ${showBottomNav ? "pb-16" : ""}`}>
        <Outlet />
      </div>

      {showBottomNav && <BottomNav active={activeTab} />}
    </div>
  );
};

export default AppShell;
