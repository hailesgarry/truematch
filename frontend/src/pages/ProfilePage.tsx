import React from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  InstagramLogo,
  TwitterLogo,
  TiktokLogo,
  YoutubeLogo,
  PencilSimple,
} from "@phosphor-icons/react";
import { useAuthStore } from "../stores/authStore";
import {
  fetchSocialLinksById,
  fetchUserBioById,
  saveUserBioById,
} from "../services/api";
import type { LinkedAccount } from "../stores/profileLinksStore";
import { useProfileBioStore } from "../stores/profileBioStore";

// Map of icon components by network type
const ICON_BY_TYPE: Record<string, React.ComponentType<any>> = {
  instagram: InstagramLogo,
  twitter: TwitterLogo,
  tiktok: TiktokLogo,
  youtube: YoutubeLogo,
  facebook: InstagramLogo, // placeholder if needed
};

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { username, avatar, userId } = useAuthStore();
  const [links, setLinks] = React.useState<LinkedAccount[]>([]);
  const getBio = useProfileBioStore((s) => s.getBio);
  const setBio = useProfileBioStore((s) => s.setBio);
  const [bio, setBioLocal] = React.useState("");
  const [editingBio, setEditingBio] = React.useState(false);
  const bioTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const handleBack = () => navigate(-1);
  const handleLinkAccount = () => navigate("/edit-profile");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!userId) return;
        const remote = await fetchSocialLinksById(userId, username);
        if (!cancelled && Array.isArray(remote)) setLinks(remote);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, username]);

  // Load bio: prefer server, fall back to local; keep local cache in sync
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = getBio(userId);
      setBioLocal(local);
      try {
        if (!userId) return;
        const server = await fetchUserBioById(userId);
        if (!cancelled && typeof server === "string") {
          setBioLocal(server);
          setBio(userId, server);
        }
      } catch {
        // ignore; rely on local
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, getBio, setBio]);

  // When editor opens, focus the textarea and place cursor at end
  React.useEffect(() => {
    if (editingBio) {
      const focusLater = () => {
        const el = bioTextareaRef.current;
        if (el) {
          el.focus();
          const len = el.value.length;
          try {
            el.setSelectionRange(len, len);
          } catch {}
        }
      };
      // Next frame to ensure element is mounted
      if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
        window.requestAnimationFrame(focusLater);
      } else {
        setTimeout(focusLater, 0);
      }
    }
  }, [editingBio]);

  if (!username) {
    return (
      <div className="p-4">
        <button
          onClick={handleBack}
          className="p-2 rounded-full text-gray-700"
          aria-label="Back"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="mt-6 text-gray-500">No user.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header (56px height, show username) */}
      <div className="flex items-center gap-3 px-3 h-14 bg-white">
        <button
          onClick={handleBack}
          className="text-gray-900"
          aria-label="Back"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="font-semibold text-gray-900 text-base truncate min-w-0">
          Profile
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-5 py-5">
          {/* Avatar */}
          <div className="flex flex-col items-center">
            {avatar ? (
              <img
                src={avatar}
                alt={`${username} avatar`}
                className="w-40 h-40 sm:w-44 sm:h-44 rounded-full object-cover shadow"
              />
            ) : (
              <div className="w-40 h-40 sm:w-44 sm:h-44 rounded-full bg-gray-300 flex items-center justify-center text-gray-700 text-4xl font-bold shadow">
                {username.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="mt-2 text-lg font-semibold text-gray-900">
              {username}
            </div>
          </div>

          {/* Social links (only show networks you linked) */}
          <div className="mt-2">
            {links.length > 0 ? (
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
            ) : (
              <div className="text-center">
                <button
                  type="button"
                  onClick={handleLinkAccount}
                  className="text-sm text-red-500 focus:outline-none"
                >
                  Link an account
                </button>
              </div>
            )}
          </div>

          {/* Short bio with edit (max ~100 words) */}
          <div className="mt-2 mx-auto w-full max-w-[80%] text-center text-sm text-gray-900">
            {!editingBio ? (
              <div>
                {bio?.trim() ? (
                  <button
                    type="button"
                    onClick={() => setEditingBio(true)}
                    className="leading-snug whitespace-pre-wrap break-words text-left mx-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                  >
                    {bio}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingBio(true)}
                    className="leading-snug text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                  >
                    Describe yourself in less than 100 words.
                  </button>
                )}
                {/* Removed separate 'Edit bio' button; bio text is now the trigger */}
              </div>
            ) : (
              <div className="text-left">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Your bio
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBioLocal(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
                  rows={4}
                  placeholder="Tell people a bit about you…"
                  ref={bioTextareaRef}
                  autoFocus
                />
                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>
                    {(() => {
                      const words = (bio || "")
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean).length;
                      const over = words > 100;
                      return over
                        ? `${words} / 100 words (too long)`
                        : `${words} / 100 words`;
                    })()}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBio(false);
                        setBioLocal(getBio(userId));
                      }}
                      className="px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 "
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // enforce ~100-word limit
                        const words = (bio || "")
                          .trim()
                          .split(/\s+/)
                          .filter(Boolean);
                        const limited = words.slice(0, 100).join(" ");
                        (async () => {
                          try {
                            if (userId) {
                              await saveUserBioById(userId, limited);
                              setBio(userId, limited);
                            }
                            setBioLocal(limited);
                          } catch {
                            if (userId) setBio(userId, limited);
                            setBioLocal(limited);
                          } finally {
                            setEditingBio(false);
                          }
                        })();
                      }}
                      className="px-3 py-1.5 rounded-md text-white bg-red-500"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Edit profile button (max-width 50%) */}
          <div className="mt-4 mx-auto w-full max-w-[50%]">
            <button
              type="button"
              onClick={handleLinkAccount}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-red-500 text-white font-medium focus:outline-none"
            >
              <PencilSimple size={18} weight="fill" />
              <span>Edit profile</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
