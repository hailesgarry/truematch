import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { useSocketStore } from "../stores/socketStore";
import { ArrowsClockwise, ArrowLeft } from "phosphor-react"; // OPTIONAL: If phosphor-react already in project
import { createAvatar } from "@dicebear/core";
import { avataaars } from "@dicebear/collection";
import {
  useProfileLinksStore,
  type SocialType,
} from "../stores/profileLinksStore";
import { Trash, PencilSimple, Check } from "phosphor-react";
import {
  fetchSocialLinksById,
  saveSocialLinksById,
  normalizeSocialUrl,
  isAllowedSocialHost,
} from "../services/api";

// Single DiceBear style (Avataaars)
// const DICEBEAR_STYLE = "avataaars";

function randomSeed(len = 12) {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Build a local SVG data URI (no network calls)
function buildDicebearDataUri() {
  const seed = randomSeed();
  const svg = createAvatar(avataaars, {
    seed,
    radius: 50,
    backgroundColor: ["b6e3f4", "c0aede", "d1d4f9"],
    backgroundType: ["gradientLinear"],
  }).toString();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const EditProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const {
    userId,
    username: currentUsername,
    avatar: currentAvatar,
    joined,
  } = useAuthStore();
  const { showToast } = useUiStore();
  const { updateProfile } = useSocketStore();

  const [username, setUsernameLocal] = useState(currentUsername);
  const [avatar, setAvatarLocal] = useState<string | null>(currentAvatar);
  const [avatarMode, setAvatarMode] = useState<"upload" | "generated">(
    currentAvatar ? "upload" : "generated"
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track initial values to determine if the user has made changes
  const initialUsernameRef = useRef<string>(currentUsername);
  const initialAvatarRef = useRef<string | null>(currentAvatar);

  // Redirect if not logged in
  React.useEffect(() => {
    if (!joined) {
      navigate("/", { replace: true });
    }
  }, [joined, navigate]);

  // Replace handleFileChange with version that sets mode
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) return;
      // (Optional) size guard: reject > 2MB
      if (file.size > 2 * 1024 * 1024) {
        showToast("Image too large (max 2MB).");
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAvatarLocal(ev.target?.result as string);
        setAvatarMode("upload");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRandomAvatar = () => {
    const url = buildDicebearDataUri();
    setAvatarLocal(url);
    setAvatarMode("generated");
  };

  const handleSave = async () => {
    const trimmed = username.trim();
    if (!trimmed) return;
    // Optimistic update + real-time emit
    updateProfile(trimmed, avatar);
    try {
      if (!userId) throw new Error("No user id");
      await saveSocialLinksById(userId, links);
    } catch {
      // keep local store; notify
      showToast("Failed to save social links (saved locally only)");
    }
    showToast("Profile updated successfully!");
    // Reset dirty flags/baselines
    initialUsernameRef.current = trimmed;
    initialAvatarRef.current = avatar;
    setLinksDirty(false);
    navigate("/groups", { replace: true });
  };

  const handleBack = () => {
    navigate(-1);
  };

  // After state declarations, add an effect to auto-generate if no avatar:
  React.useEffect(() => {
    // If there is no stored avatar, generate one, but consider it the initial value
    if (!currentAvatar) {
      const url = buildDicebearDataUri();
      setAvatarLocal(url);
      setAvatarMode("generated");
      initialAvatarRef.current = url; // treat auto-generated as initial, not a user change
    } else {
      initialAvatarRef.current = currentAvatar;
    }
    initialUsernameRef.current = currentUsername;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track if linked accounts changed so Save enables even without username/avatar changes
  const [linksDirty, setLinksDirty] = useState(false);

  // Compute whether Save should be enabled
  const trimmedUsername = username.trim();
  const hasUsernameChange =
    trimmedUsername !== (initialUsernameRef.current || "").trim();
  const hasAvatarChange = avatar !== initialAvatarRef.current;
  const saveDisabled =
    trimmedUsername.length === 0 ||
    (!hasUsernameChange && !hasAvatarChange && !linksDirty);

  // Linked accounts state (persisted locally for now)
  const { links, upsertByType, removeLink, updateLink, setLinks } =
    useProfileLinksStore();
  const [accountType, setAccountType] = useState<SocialType>("twitter");
  const [accountUrl, setAccountUrl] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUrl, setEditingUrl] = useState<string>("");

  // Load links from backend on mount
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!userId) return;
        // Pass legacy username once to allow server-side auto-migration if needed
        const remote = await fetchSocialLinksById(userId, currentUsername);
        if (!cancelled && Array.isArray(remote)) {
          setLinks(remote);
          setLinksDirty(false);
        }
      } catch {
        // ignore; keep local
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, currentUsername, setLinks]);

  function validateUrl(u: string) {
    try {
      const url = new URL(u);
      return ["http:", "https:"].includes(url.protocol);
    } catch {
      return false;
    }
  }

  const handleAddLink = () => {
    const url = accountUrl.trim();
    const normalized = normalizeSocialUrl(accountType, url);
    if (
      !validateUrl(normalized) ||
      !isAllowedSocialHost(accountType, normalized)
    ) {
      showToast("Enter a valid URL (https://…)");
      return;
    }
    // De-duplicate by type: upsert behavior
    upsertByType(accountType, normalized);
    setAccountUrl("");
    setLinksDirty(true);
  };

  const NetworkIcon: React.FC<{ type: SocialType }> = ({ type }) => {
    const cls = "w-5 h-5";
    switch (type) {
      case "facebook":
        return (
          <svg
            className={cls}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M22 12.07C22 6.48 17.52 2 11.93 2S2 6.48 2 12.07c0 5.01 3.66 9.16 8.44 9.93v-7.02H7.9v-2.91h2.54V9.41c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.87h2.78l-.44 2.91h-2.34V22c4.78-.77 8.44-4.92 8.44-9.93z" />
          </svg>
        );
      case "twitter":
        return (
          <svg
            className={cls}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M22.46 6c-.77.35-1.6.59-2.46.7a4.3 4.3 0 0 0 1.88-2.38 8.59 8.59 0 0 1-2.72 1.04A4.29 4.29 0 0 0 11.2 8.1a12.18 12.18 0 0 1-8.85-4.49 4.29 4.29 0 0 0 1.33 5.73 4.26 4.26 0 0 1-1.94-.54v.06c0 2.08 1.48 3.82 3.44 4.22-.36.1-.75.16-1.15.16-.28 0-.55-.03-.81-.08.55 1.72 2.15 2.97 4.05 3a8.6 8.6 0 0 1-5.33 1.84c-.34 0-.68-.02-1.01-.06A12.15 12.15 0 0 0 8.29 21c7.9 0 12.23-6.54 12.23-12.21 0-.19 0-.39-.01-.58A8.7 8.7 0 0 0 22.46 6z" />
          </svg>
        );
      case "tiktok":
        return (
          <svg
            className={cls}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M21 8.5a7.46 7.46 0 0 1-4.36-1.4v6.37a6.47 6.47 0 1 1-6.47-6.47c.37 0 .73.03 1.08.1v3.01a3.5 3.5 0 1 0 2.6 3.37V2h2.8a4.66 4.66 0 0 0 4.35 3.06V8.5z" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col px-4">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 ">
        <div className="max-w-md mx-auto flex items-center justify-between gap-2 h-14">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={handleBack}
              aria-label="Back"
              className="text-gray-900 focus:outline-none"
            >
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-base font-semibold text-gray-900 truncate">
              Edit profile
            </h1>
          </div>
          <button
            onClick={handleSave}
            disabled={saveDisabled}
            aria-disabled={saveDisabled}
            className={`px-3 py-1.5 text-sm rounded-md text-white focus:outline-none focus:ring-2 focus:ring-red-200 ${
              saveDisabled
                ? "bg-red-400/60 cursor-not-allowed opacity-60"
                : "bg-red-500"
            }`}
          >
            Save
          </button>
        </div>
      </div>

      <div className="w-full max-w-md mx-auto mt-4 mb-20 sm:mt-6 p-6 bg-white rounded-2xl border border-gray-200">
        <div className="flex flex-col items-center mb-8">
          <div className="relative w-24 h-24 rounded-full bg-gray-100 border border-gray-200 mb-4 overflow-hidden group">
            {avatar ? (
              <img
                src={avatar}
                alt="Avatar preview"
                className="w-full h-full object-cover"
                draggable={false}
                // If anything ever fails (e.g., an external URL), regenerate locally
                onError={() => {
                  if (avatarMode === "generated") {
                    setAvatarLocal(buildDicebearDataUri());
                  } else {
                    setAvatarLocal(null);
                  }
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-gray-400 text-sm">No avatar</span>
              </div>
            )}
            {/* Hover overlay for quick shuffle when generated */}
            {avatarMode === "generated" && (
              <button
                type="button"
                onClick={handleRandomAvatar}
                title="Shuffle avatar"
                aria-label="Shuffle avatar"
                className="absolute inset-0 bg-black/0 flex items-center justify-center text-white opacity-100 md:opacity-0 transition rounded-full focus:outline-none focus:ring-2 focus:ring-red-200"
              >
                <ArrowsClockwise size={26} />
              </button>
            )}
          </div>

          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
          />

          <div className="flex gap-3 justify-center items-center flex-nowrap">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-800 focus:outline-none whitespace-nowrap"
            >
              Upload photo
            </button>
            <button
              type="button"
              onClick={handleRandomAvatar}
              className="px-3 py-2 text-sm rounded-lg border border-red-300 text-red-500 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-red-200"
            >
              {avatarMode === "generated"
                ? "Shuffle avatar"
                : "Use generated avatar"}
            </button>
          </div>

          <p className="mt-3 text-xs text-gray-500 text-center max-w-xs leading-snug">
            You can upload a photo or use a privacy‑friendly generated avatar
            (Avataaars). Shuffle to explore variations. Your choice is saved
            when you click Save.
          </p>
        </div>

        <div className="mb-6">
          <label
            htmlFor="edit-username"
            className="block text-sm font-medium text-gray-800 mb-1"
          >
            Username
          </label>
          <input
            id="edit-username"
            name="username"
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
            value={username}
            onChange={(e) => setUsernameLocal(e.target.value)}
          />
        </div>

        {/* Link an account */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">
            Link an account
          </h2>
          {/* TODO (next steps):
              - Inline edit existing links (type+URL) in-place
              - De-duplicate by type: allow only one link per network
              - Server sync: persist links via backend API per user
              - Use brand icons in the list for each network */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <select
              className="w-full sm:w-40 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as SocialType)}
            >
              <option value="facebook">Facebook</option>
              <option value="twitter">Twitter</option>
              <option value="tiktok">TikTok</option>
            </select>
            <input
              type="url"
              placeholder="https://…"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
              value={accountUrl}
              onChange={(e) => setAccountUrl(e.target.value)}
            />
            <button
              type="button"
              onClick={handleAddLink}
              className="px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
            >
              {links.length > 0 ? "Add more" : "Add"}
            </button>
          </div>

          {/* Existing linked accounts */}
          {links.length > 0 && (
            <ul className="mt-4 divide-y border rounded-lg">
              {links.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-500 w-6 flex justify-center">
                      <NetworkIcon type={l.type} />
                    </span>
                    {editingId === l.id ? (
                      <input
                        className="flex-1 min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
                        value={editingUrl}
                        onChange={(e) => setEditingUrl(e.target.value)}
                        placeholder="https://…"
                      />
                    ) : (
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-sm text-blue-600 truncate hover:underline"
                      >
                        {l.url}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {editingId === l.id ? (
                      <button
                        type="button"
                        className="p-1.5 rounded hover:bg-gray-100 text-green-600"
                        aria-label="Save link"
                        onClick={() => {
                          const u = normalizeSocialUrl(
                            l.type,
                            editingUrl.trim()
                          );
                          if (
                            !validateUrl(u) ||
                            !isAllowedSocialHost(l.type, u)
                          ) {
                            showToast("Enter a valid URL (https://…)");
                            return;
                          }
                          updateLink(l.id, { url: u });
                          setLinksDirty(true);
                          setEditingId(null);
                          setEditingUrl("");
                        }}
                      >
                        <Check size={16} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                        aria-label="Edit link"
                        onClick={() => {
                          setEditingId(l.id);
                          setEditingUrl(l.url);
                        }}
                      >
                        <PencilSimple size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        removeLink(l.id);
                        setLinksDirty(true);
                      }}
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                      aria-label="Remove link"
                    >
                      <Trash size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default EditProfilePage;
