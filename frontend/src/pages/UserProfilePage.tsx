import React from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  PaperPlaneTilt,
  InstagramLogo,
  TwitterLogo,
  TiktokLogo,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { useAvatarStore } from "../stores/avatarStore";
import { useAuthStore } from "../stores/authStore";
import {
  fetchSocialLinksForUsername,
  fetchSocialLinksById,
  fetchUserBioById,
  resolveUserIdByUsername,
} from "../services/api";
import type { LinkedAccount } from "../stores/profileLinksStore";

// Map of icon components by network type
const ICON_BY_TYPE: Record<string, React.ComponentType<any>> = {
  instagram: InstagramLogo,
  twitter: TwitterLogo,
  tiktok: TiktokLogo,
  youtube: YoutubeLogo,
  facebook: InstagramLogo, // placeholder if needed
};

const UserProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { username: routeUser } = useParams();
  const username = (routeUser || "").trim();
  const { username: me, userId } = useAuthStore();
  const getAvatar = useAvatarStore((s) => s.getAvatar);
  const avatarUrl = getAvatar(username) || undefined;
  const [links, setLinks] = React.useState<LinkedAccount[]>([]);
  const [bio, setBio] = React.useState<string>("");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!username) return;
      try {
        let remote: LinkedAccount[] = [];
        // If you're viewing your own profile, prefer ID-based fetch
        if (me && userId && me.toLowerCase() === username.toLowerCase()) {
          remote = await fetchSocialLinksById(userId, me);
        } else {
          remote = await fetchSocialLinksForUsername(username);
        }
        if (!cancelled && Array.isArray(remote)) setLinks(remote);
      } catch {
        // ignore if not found
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, me, userId]);

  // Fetch bio by userId (self) or resolve by username
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!username) return;
      try {
        let id: string | null = null;
        if (me && userId && me.toLowerCase() === username.toLowerCase()) {
          id = userId;
        } else {
          id = await resolveUserIdByUsername(username);
        }
        if (!id) return;
        const b = await fetchUserBioById(id);
        if (!cancelled && typeof b === "string") setBio(b);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, me, userId]);

  const handleBack = () => navigate(-1);
  const handleDM = () =>
    navigate(`/dm/${encodeURIComponent(username)}`, {
      state: { from: /^\/chat(\/|$)?/.test(pathname) ? "/chat" : "/direct" },
    });

  if (!username) {
    return (
      <div className="p-4">
        <button
          onClick={handleBack}
          className="text-gray-900"
          aria-label="Back"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="mt-6 text-gray-500">No user specified.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header (56px height, show username) */}
      <div className="flex items-center gap-4 px-3 h-14 bg-white">
        <button
          onClick={handleBack}
          className="text-gray-900"
          aria-label="Back"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="font-semibold text-gray-900 text-base truncate min-w-0">
          {username}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-5 py-5">
          {/* Avatar */}
          <div className="flex flex-col items-center">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={`${username} avatar`}
                className="w-40 h-40 sm:w-44 sm:h-44 rounded-full object-cover"
              />
            ) : (
              <div className="w-40 h-40 sm:w-44 sm:h-44 rounded-full bg-gray-300 flex items-center justify-center text-gray-700 text-4xl font-bold">
                {username.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="mt-2 text-lg font-semibold text-gray-900">
              {username}
              {me && me === username ? (
                <span className="ml-2 text-xs text-gray-500 align-middle">
                  (you)
                </span>
              ) : null}
            </div>
          </div>

          {/* Social links (only show if user has any) */}
          {links.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-center gap-3 text-gray-500">
                {links.map((l) => {
                  const Icon = ICON_BY_TYPE[l.type as string] || InstagramLogo;
                  return (
                    <a
                      key={l.id}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`${l.type} profile`}
                      className="p-1 rounded focus:outline-none"
                    >
                      <Icon size={28} weight="regular" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Short bio (only show if present) */}
          {bio?.trim() && (
            <div className="mt-2 mx-auto w-full max-w-[80%] text-center text-sm text-gray-900">
              <p className="leading-snug whitespace-pre-wrap break-words">
                {bio}
              </p>
            </div>
          )}

          {/* DM button (max-width 50%) */}
          <div className="mt-4 mx-auto w-full max-w-[50%]">
            <button
              type="button"
              onClick={handleDM}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-red-500 text-white font-medium focus:outline-none"
            >
              <PaperPlaneTilt size={18} weight="fill" />
              <span>Message</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfilePage;
