import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DatingCard from "../components/common/DatingCard";
// REMOVED: import Header from "../components/layout/Header";
// REMOVED: import BottomNav from "../components/layout/BottomNav";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { fetchDatingProfiles, fetchDatingProfile } from "../services/api";
import type { DatingProfile } from "../types";
import { filterProfilesByPreferences } from "../utils/dating";
import { useLikesStore } from "../stores/likesStore";
import Modal from "../components/common/Modal";
import { useSocketStore } from "../stores/socketStore";
import { useQuery } from "@tanstack/react-query";
import { useDatingStore } from "../stores/datingStore";

const DatingPage: React.FC = () => {
  const navigate = useNavigate();
  const { joined, username } = useAuthStore();
  const { showToast } = useUiStore();
  const { ensureConnected, likeUser, unlikeUser } = useSocketStore();
  const byUser = useLikesStore((s) => s.byUser);

  const [profiles, setProfiles] = useState<DatingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeletedBanner, setShowDeletedBanner] = useState(false);
  // Derive "do I have a profile" reactively
  const { data: meProfile } = useQuery({
    queryKey: ["datingProfile", username],
    queryFn: () => fetchDatingProfile(String(username)),
    enabled: !!username,
  });
  const localProfile = useDatingStore((s) => s.profile);
  const hasMyProfile = useMemo(() => {
    if (meProfile !== undefined) {
      if (meProfile === null) return false;
      const p: any = meProfile;
      return Boolean(
        (Array.isArray(p?.photos) && p.photos.length > 0) ||
          p?.photoUrl ||
          p?.photo ||
          p?.mood ||
          typeof p?.age === "number" ||
          p?.gender ||
          p?.religion
      );
    }
    return Boolean(localProfile?.photo || (localProfile as any)?.mood);
  }, [meProfile, localProfile]);
  const [showLikeGate, setShowLikeGate] = useState(false);

  useEffect(() => {
    ensureConnected();
  }, [ensureConnected]);

  // One-time banner after deletion
  useEffect(() => {
    try {
      if (sessionStorage.getItem("datingProfileDeleted") === "1") {
        setShowDeletedBanner(true);
        sessionStorage.removeItem("datingProfileDeleted");
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!joined) {
      navigate("/", { replace: true });
      return;
    }
    (async () => {
      try {
        const list = await fetchDatingProfiles();
        const withoutSelf = (list || []).filter(
          (p) =>
            (p.username || "").toLowerCase() !== (username || "").toLowerCase()
        );
        const filtered = filterProfilesByPreferences(withoutSelf, username);
        const withPhoto = filtered.filter(
          (p) =>
            (Array.isArray(p.photos) && p.photos.length > 0) ||
            p.photoUrl ||
            p.photo
        );
        setProfiles(withPhoto.length ? withPhoto : filtered);
      } catch (e) {
        console.error("Failed to load dating profiles:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [joined, navigate, username]);

  const handleWave = (peer: string) => {
    const target = (peer || "").trim();
    if (!target) return;
    if (username && target.toLowerCase() === username.toLowerCase()) {
      showToast("You can’t message yourself", 2000);
      return;
    }
    navigate(`/dm/${encodeURIComponent(target)}`, {
      state: { suggest: "wave", from: "/direct" },
    });
  };

  const hasAny = profiles.length > 0;

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Header is provided by AppShell */}
      <div className="flex-1 overflow-y-auto px-4">
        <div className="max-w-md mx-auto py-4">
          {showDeletedBanner && (
            <div className="mb-4 p-3 rounded-md bg-green-50 text-green-800 text-sm border border-green-200">
              Your dating profile was deleted.
            </div>
          )}
          {loading ? (
            <div className="text-sm text-gray-500 py-10">Loading profiles…</div>
          ) : !hasAny ? (
            <>
              <p className="text-sm text-gray-500 mb-4">
                No dating profiles yet. Be the first to create one!
              </p>
              <button
                type="button"
                onClick={() => navigate("/dating-profile")}
                className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold shadow"
              >
                Create Dating Profile
              </button>
            </>
          ) : (
            <div className="grid gap-4 place-items-center">
              {profiles.map((p: DatingProfile) => {
                const imageUrl =
                  (Array.isArray(p.photos) && p.photos[0]) ||
                  p.photoUrl ||
                  p.photo ||
                  "/placeholder.jpg";
                const photosArr =
                  Array.isArray(p.photos) && p.photos.length
                    ? p.photos
                    : imageUrl
                    ? [imageUrl]
                    : [];
                const uname = p.username;
                const liked = !!byUser[uname.toLowerCase()]?.outgoing;

                return (
                  <DatingCard
                    key={uname}
                    name={uname}
                    age={p.age}
                    status={p.mood || ""}
                    imageUrl={imageUrl}
                    photos={photosArr}
                    city={p.location?.city?.trim()}
                    state={p.location?.state?.trim()}
                    locationLabel={
                      p.location?.city?.trim() ||
                      (p.location?.formatted
                        ? p.location.formatted.split(",")[0].trim()
                        : "") ||
                      ""
                    }
                    liked={liked}
                    interceptLike={() => {
                      if (!hasMyProfile) {
                        setShowLikeGate(true);
                        return true; // block
                      }
                      return false;
                    }}
                    onLike={() => likeUser(uname)}
                    onUnlike={() => unlikeUser(uname)}
                    onWave={() => handleWave(uname)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* BottomNav is provided by AppShell; no extra spacer needed */}
      <Modal
        isOpen={showLikeGate}
        onClose={() => setShowLikeGate(false)}
        title="Create a dating profile"
        ariaDescription="To like people, you need to create a dating profile."
        size="md"
        centered
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            You can’t use Likes yet. Create your dating profile so others can
            get to know you.
          </p>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => navigate("/dating-profile")}
              className="w-full px-4 py-2 rounded-md bg-red-600 text-white"
              data-autofocus
            >
              Create dating profile
            </button>
            <button
              type="button"
              onClick={() => setShowLikeGate(false)}
              className="w-full px-4 py-2 rounded-md border text-gray-900"
            >
              Not now
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default DatingPage;
