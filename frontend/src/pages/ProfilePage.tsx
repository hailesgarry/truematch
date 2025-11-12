import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  FacebookLogo,
  InstagramLogo,
  TwitterLogo,
  TiktokLogo,
  PencilSimple,
  PaperPlaneTilt,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../stores/authStore";
import { useAvatarStore } from "../stores/avatarStore";
import {
  fetchProfileById,
  fetchUserBioById,
  saveUserBioById,
} from "../services/api";
import { useProfileBioStore } from "../stores/profileBioStore";
import PageHeader from "../components/common/PageHeader";
import FullscreenOverlay from "../components/ui/FullscreenOverlay";
import Field, { fieldControlClasses } from "../components/ui/Field";
import ActionButtons from "../components/ui/ActionButtons";
import { useCurrentProfile } from "../hooks/useCurrentProfile";
import { navigateToDmThread } from "../lib/userIdentity";

const LINKED_ACCOUNT_MARKER = "linked-social-account";
const SUPPORTED_PLATFORMS = [
  "Tik Tok",
  "Twitter",
  "Instagram",
  "Facebook",
] as const;
type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

type LinkedAccount = {
  platform: SupportedPlatform;
  url: string;
};

type IconType = typeof FacebookLogo;

const decodeLinkedAccount = (raw: string): LinkedAccount | null => {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const marker = (parsed as any)?.marker;
    const platform = (parsed as any)?.platform;
    const url = (parsed as any)?.url;
    if (marker !== LINKED_ACCOUNT_MARKER) return null;
    if (typeof url !== "string" || !url.trim()) return null;
    if (
      platform !== "Tik Tok" &&
      platform !== "Twitter" &&
      platform !== "Instagram" &&
      platform !== "Facebook"
    ) {
      return null;
    }
    return { platform, url };
  } catch (error) {
    if (raw.trim().startsWith("{")) {
      console.warn("Failed to parse linked account entry", error);
    }
    return null;
  }
};

const PLATFORM_ICON: Record<SupportedPlatform, IconType> = {
  Facebook: FacebookLogo,
  Instagram: InstagramLogo,
  "Tik Tok": TiktokLogo,
  Twitter: TwitterLogo,
};

const BIO_MAX_LENGTH = 90;

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { userId: routeParam = "" } = useParams<{ userId?: string }>();
  const routeUserId = (routeParam || "").trim();
  const { username, avatar, userId: myUserId } = useAuthStore();
  const avatarMap = useAvatarStore((s) => s.avatars);
  const ensureAvatar = useAvatarStore((s) => s.ensure);
  const { profile } = useCurrentProfile();
  const getBio = useProfileBioStore((s) => s.getBio);
  const setBio = useProfileBioStore((s) => s.setBio);
  const [bio, setBioLocal] = React.useState("");
  const [isBioOverlayOpen, setIsBioOverlayOpen] = React.useState(false);
  const [bioDraft, setBioDraft] = React.useState("");

  const isOwnProfile = !routeUserId || routeUserId === myUserId;
  const viewedUserId = routeUserId || myUserId || "";

  const { data: viewerProfile, isLoading: isViewerProfileLoading } = useQuery({
    queryKey: ["profile", "view", viewedUserId],
    queryFn: () => fetchProfileById(viewedUserId),
    enabled: Boolean(viewedUserId && !isOwnProfile),
    staleTime: 60_000,
  });

  const activeProfile = isOwnProfile ? profile : viewerProfile ?? null;
  const viewerUsername = !isOwnProfile ? activeProfile?.username : undefined;
  const displayUsername = (isOwnProfile ? username : viewerUsername) || "";

  const linkedAccounts = React.useMemo(() => {
    const entries = Array.isArray(activeProfile?.friends)
      ? activeProfile?.friends
      : [];
    return entries
      .map((item) => decodeLinkedAccount(item))
      .filter((account): account is LinkedAccount => account != null);
  }, [activeProfile?.friends]);

  const avatarKey = displayUsername ? displayUsername.toLowerCase() : "";
  const avatarFromCache = avatarKey
    ? avatarMap[avatarKey] ?? undefined
    : undefined;
  const fallbackAvatar = isOwnProfile
    ? profile?.avatarUrl || avatar || undefined
    : activeProfile?.avatarUrl || undefined;
  const avatarSrc = (avatarFromCache ?? undefined) || fallbackAvatar;

  React.useEffect(() => {
    if (!myUserId) return;
    if (!routeUserId) {
      navigate(`/profile/${encodeURIComponent(myUserId)}`, { replace: true });
    }
  }, [routeUserId, myUserId, navigate]);

  const handleBack = () => navigate(-1);
  const handlePrimaryAction = () => {
    if (isOwnProfile) {
      if (!myUserId) return;
      navigate(`/edit-profile/${encodeURIComponent(myUserId)}`);
    } else if (viewedUserId) {
      void navigateToDmThread(navigate, {
        userId: viewedUserId,
        username: displayUsername,
        state: { from: "/profile", viewedUserId },
      });
    }
  };

  // Ensure latest Cloudinary avatar for self profile
  React.useEffect(() => {
    if (username) ensureAvatar(username);
  }, [username, ensureAvatar]);

  React.useEffect(() => {
    if (viewerUsername) {
      ensureAvatar(viewerUsername);
    }
  }, [viewerUsername, ensureAvatar]);

  // Load bio: prefer server, fall back to local; keep local cache in sync
  React.useEffect(() => {
    if (!viewedUserId) return;
    let cancelled = false;
    (async () => {
      const local = getBio(viewedUserId);
      setBioLocal(local);
      try {
        const server = await fetchUserBioById(viewedUserId);
        if (!cancelled && typeof server === "string") {
          setBioLocal(server);
          setBio(viewedUserId, server);
        }
      } catch {
        // ignore; rely on local
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewedUserId, getBio, setBio]);
  const openBioOverlay = () => {
    if (!isOwnProfile) return;
    setIsBioOverlayOpen(true);
  };
  const closeBioOverlay = () => setIsBioOverlayOpen(false);

  const handleBioSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    const trimmed = bioDraft.trim();
    if (!trimmed) return;
    const limited = trimmed.slice(0, BIO_MAX_LENGTH);
    try {
      if (!isOwnProfile || !viewedUserId) return;
      await saveUserBioById(viewedUserId, limited);
      setBio(viewedUserId, limited);
      setBioLocal(limited);
    } catch {
      if (viewedUserId) setBio(viewedUserId, limited);
      setBioLocal(limited);
    } finally {
      setBioDraft(limited);
      closeBioOverlay();
    }
  };

  React.useEffect(() => {
    if (!isOwnProfile && isBioOverlayOpen) {
      setIsBioOverlayOpen(false);
    }
  }, [isOwnProfile, isBioOverlayOpen]);

  React.useEffect(() => {
    if (isBioOverlayOpen) {
      setBioDraft((bio ?? "").slice(0, BIO_MAX_LENGTH));
    }
  }, [isBioOverlayOpen, bio]);

  const trimmedBio = (bio ?? "").trim();

  if (!username || !myUserId) {
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

  if (!isOwnProfile && isViewerProfileLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white text-gray-500">
        Loading profile…
      </div>
    );
  }

  if (!isOwnProfile && !activeProfile) {
    return (
      <div className="p-4">
        <button
          onClick={handleBack}
          className="p-2 rounded-full text-gray-700"
          aria-label="Back"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="mt-6 text-gray-500">We couldn't find that user.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <PageHeader
        title="Profile"
        onBack={isOwnProfile ? undefined : handleBack}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-5 py-5">
          {/* Avatar and username */}
          <div className="flex flex-col items-center">
            <div className="relative flex items-center justify-center">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={`${displayUsername || username} avatar`}
                  className="h-44 w-44 rounded-full object-cover shadow"
                />
              ) : (
                <div className="flex h-44 w-44 items-center justify-center rounded-full bg-gray-300 text-gray-700 text-4xl font-bold shadow">
                  {(displayUsername || username || "?").charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="mt-3 text-lg font-semibold text-gray-900">
              {displayUsername || username}
            </div>
          </div>

          {/* Social links */}
          {linkedAccounts.length > 0 && (
            <div className="mt-3 flex items-center justify-center gap-3 text-gray-500">
              {linkedAccounts.map((account, index) => {
                const Icon = PLATFORM_ICON[account.platform];
                return (
                  <a
                    key={`${account.platform}-${index}`}
                    href={account.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${account.platform} profile`}
                    className="rounded focus:outline-none"
                  >
                    <Icon size={28} weight="regular" />
                  </a>
                );
              })}
            </div>
          )}

          {/* Bio */}
          <div className="mt-3 text-center">
            {trimmedBio ? (
              isOwnProfile ? (
                <button
                  type="button"
                  onClick={openBioOverlay}
                  className="text-sm text-gray-900 leading-snug whitespace-pre-wrap break-words focus:outline-none"
                >
                  {trimmedBio}
                </button>
              ) : (
                <p className="text-sm text-gray-900 leading-snug whitespace-pre-wrap break-words">
                  {trimmedBio}
                </p>
              )
            ) : isOwnProfile ? (
              <button
                type="button"
                onClick={openBioOverlay}
                className="text-xs text-gray-500 leading-snug focus:outline-none"
              >
                Describe yourself in less than 100 words.
              </button>
            ) : (
              <p className="text-xs text-gray-500 leading-snug">
                This user hasn't added a bio yet.
              </p>
            )}
          </div>

          {/* Primary action */}
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={!isOwnProfile && (!displayUsername || !activeProfile)}
              className="flex items-center justify-center gap-2 rounded-lg bg-primary-gradient px-6 py-3 text-white font-medium focus:outline-none disabled:opacity-60"
            >
              {isOwnProfile ? (
                <PencilSimple size={18} weight="fill" />
              ) : (
                <PaperPlaneTilt size={18} weight="fill" />
              )}
              <span>{isOwnProfile ? "Edit profile" : "Message"}</span>
            </button>
          </div>
        </div>
      </div>
      {isOwnProfile ? (
        <FullscreenOverlay isOpen={isBioOverlayOpen} onClose={closeBioOverlay}>
          <div className="flex min-h-full flex-col bg-white">
            <header className="sticky top-0 z-10 flex h-12 items-center bg-white px-4">
              <button
                type="button"
                onClick={closeBioOverlay}
                className="flex items-center justify-center"
                aria-label="Close"
              >
                <ArrowLeft size={24} className="text-gray-900" />
              </button>
            </header>
            <form className="flex-1 px-4 py-6" onSubmit={handleBioSubmit}>
              <div className="flex h-full flex-col">
                <div className="flex-1 space-y-6 overflow-y-auto pb-8">
                  <Field
                    label="Bio"
                    htmlFor="profile-bio"
                    hint={
                      <span
                        className={
                          BIO_MAX_LENGTH - bioDraft.length <= 10
                            ? "text-red-500"
                            : ""
                        }
                      >
                        {BIO_MAX_LENGTH - bioDraft.length} characters remaining
                      </span>
                    }
                  >
                    <textarea
                      id="profile-bio"
                      className={`${fieldControlClasses} min-h-[160px] resize-vertical`}
                      value={bioDraft}
                      onChange={(event) =>
                        setBioDraft(event.target.value.slice(0, BIO_MAX_LENGTH))
                      }
                      placeholder="Add a short bio about yourself"
                      rows={5}
                      autoFocus
                    />
                  </Field>
                </div>
                <ActionButtons
                  className="mt-8"
                  secondaryText="Cancel"
                  onSecondary={closeBioOverlay}
                  primaryText="Save"
                  primaryDisabled={
                    bioDraft.trim().length === 0 ||
                    bioDraft.trim() === (bio ?? "").trim()
                  }
                />
              </div>
            </form>
          </div>
        </FullscreenOverlay>
      ) : null}
    </div>
  );
};

export default ProfilePage;
