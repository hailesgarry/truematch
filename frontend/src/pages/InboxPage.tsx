import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useGroupStore } from "../stores/groupStore";
import { useSocketStore } from "../stores/socketStore";
import { fetchGroups } from "../services/api"; // removed unused fetchProfilesByUsernames
import GroupCard from "../components/common/GroupCard";
import { useNotificationStore } from "../stores/notificationStore";
import { useLikesStore } from "../stores/likesStore";
import { useQuery } from "@tanstack/react-query";
import { fetchDatingProfile, fetchProfilesByUsernames } from "../services/api";
import { useDatingStore } from "../stores/datingStore";
import DatingCard from "../components/common/DatingCard";
import type { DatingProfile } from "../types";

const InboxPage: React.FC = () => {
  const navigate = useNavigate();

  // Tab state
  const [tab, setTab] = useState<"general" | "likes" | "myLikes">("general");

  // Extracted tabs row (static; no sticky/scroll logic)
  // Derive whether I have a profile; if not, hide likes tabs content
  const { username } = useAuthStore();
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

  const TabsRow: React.FC<{
    hasIncomingLikes: boolean;
    activeTab: "general" | "likes" | "myLikes";
  }> = ({ hasIncomingLikes, activeTab }) => (
    <div className="bg-white">
      <div className="max-w-md mx-auto px-4">
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setTab("general")}
            className={[
              "relative px-4 py-2 rounded-full text-sm font-medium text-center transition-colors",
              activeTab === "general"
                ? "bg-gray-200 text-gray-900 "
                : "bg-gray-100 text-gray-500",
            ].join(" ")}
          >
            General
          </button>

          <button
            type="button"
            onClick={() => setTab("likes")}
            className={[
              "relative px-4 py-2 rounded-full text-sm font-medium text-center transition-colors",
              activeTab === "likes"
                ? "bg-gray-200 text-gray-900"
                : "bg-gray-100 text-gray-500",
            ].join(" ")}
          >
            Liked Me
            {activeTab !== "likes" && hasIncomingLikes && (
              <span
                className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white"
                aria-hidden
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => setTab("myLikes")}
            className={[
              "relative px-4 py-2 rounded-full text-sm font-medium text-center transition-colors",
              activeTab === "myLikes"
                ? "bg-gray-200 text-gray-900"
                : "bg-gray-100 text-gray-500",
            ].join(" ")}
          >
            My Likes
            {/* Removed red dot for My Likes */}
          </button>
        </div>
      </div>
    </div>
  );

  // Stores
  const { joined } = useAuthStore();
  const { groups, setGroups, selectGroup } = useGroupStore();
  const {
    ensureConnected,
    joinGroup,
    setActiveGroup,
    joinedGroupIds,
    likeUser,
    unlikeUser,
  } = useSocketStore();

  // Likes state
  const byUser = useLikesStore((s) => s.byUser);
  const upsertIncoming = useLikesStore((s) => s.upsertIncoming);
  const setOutgoingProfile = useLikesStore((s) => s.setOutgoingProfile);

  // NEW: shared last-seen values from store
  const lastSeenIncomingAt = useLikesStore((s) => s.lastSeenIncomingAt);
  const lastSeenOutgoingAt = useLikesStore((s) => s.lastSeenOutgoingAt);
  const setLastSeenIncoming = useLikesStore((s) => s.setLastSeenIncoming);
  const setLastSeenOutgoing = useLikesStore((s) => s.setLastSeenOutgoing);

  const likesList = React.useMemo(
    () =>
      Object.values(byUser)
        .filter((e) => !!e.incoming)
        .sort((a, b) => b.incoming!.at - a.incoming!.at),
    [byUser]
  );

  const myLikesListRaw = React.useMemo(
    () =>
      Object.values(byUser)
        .filter((e) => !!e.outgoing)
        .sort((a, b) => b.outgoing!.at - a.outgoing!.at),
    [byUser]
  );

  // Latest timestamps (lists are already sorted desc)
  const latestIncomingAt = likesList[0]?.incoming?.at ?? 0;
  const latestOutgoingAt = myLikesListRaw[0]?.outgoing?.at ?? 0;

  // Whether there is something new since last time user viewed each tab
  const showIncomingDot = latestIncomingAt > lastSeenIncomingAt;
  // Removed showOutgoingDot since we no longer display a dot on My Likes

  // When user opens Likes tab, mark newest as seen immediately (shared store)
  useEffect(() => {
    if (tab === "likes" && latestIncomingAt > lastSeenIncomingAt) {
      setLastSeenIncoming(latestIncomingAt);
    }
  }, [tab, latestIncomingAt, lastSeenIncomingAt, setLastSeenIncoming]);

  useEffect(() => {
    if (tab === "myLikes" && latestOutgoingAt > lastSeenOutgoingAt) {
      setLastSeenOutgoing(latestOutgoingAt);
    }
  }, [tab, latestOutgoingAt, lastSeenOutgoingAt, setLastSeenOutgoing]);

  // If a new like comes in while you're on that tab, consider it seen right away
  useEffect(() => {
    if (tab === "likes" && latestIncomingAt > lastSeenIncomingAt) {
      setLastSeenIncoming(latestIncomingAt);
    }
  }, [tab, latestIncomingAt, lastSeenIncomingAt, setLastSeenIncoming]);

  useEffect(() => {
    if (tab === "myLikes" && latestOutgoingAt > lastSeenOutgoingAt) {
      setLastSeenOutgoing(latestOutgoingAt);
    }
  }, [tab, latestOutgoingAt, lastSeenOutgoingAt, setLastSeenOutgoing]);

  // Derived list for My Likes that only includes items with an outgoing.profile
  const myLikesList = React.useMemo(
    () => myLikesListRaw.filter((e) => !!e.outgoing?.profile),
    [myLikesListRaw]
  );

  // Small hydration step: if a like profile lacks photos[], fetch full profiles and update store
  const hydratedRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    const candidates = new Set<string>();

    // Incoming likes: check if profile is missing multi-photos
    for (const item of likesList) {
      const uname = (
        item.username ||
        item.incoming?.profile?.username ||
        ""
      ).toLowerCase();
      if (!uname) continue;
      const prof: any = item.incoming?.profile;
      const photosArr: any[] | undefined = prof?.photos;
      if (!Array.isArray(photosArr) || photosArr.length <= 1) {
        candidates.add(uname);
      }
    }

    // Outgoing likes
    for (const item of myLikesListRaw) {
      const uname = (
        item.username ||
        item.outgoing?.profile?.username ||
        ""
      ).toLowerCase();
      if (!uname) continue;
      const prof: any = item.outgoing?.profile;
      const photosArr: any[] | undefined = prof?.photos;
      if (!Array.isArray(photosArr) || photosArr.length <= 1) {
        candidates.add(uname);
      }
    }

    // Filter out already hydrated
    const toFetch = Array.from(candidates).filter(
      (u) => !hydratedRef.current.has(u)
    );
    if (toFetch.length === 0) return;

    // Batch in reasonable chunks
    const batch = toFetch.slice(0, 25);

    (async () => {
      try {
        const profiles: DatingProfile[] = await fetchProfilesByUsernames(batch);
        for (const p of profiles) {
          const key = (p.username || "").toLowerCase();
          if (!key) continue;
          hydratedRef.current.add(key);

          // Build a compact LikeProfile with photos merged (photos[] + primary fallback)
          const mergedPhotos = Array.from(
            new Set(
              [
                ...(Array.isArray(p.photos) ? p.photos : []),
                p.photoUrl,
                (p as any).photo,
              ].filter(Boolean) as string[]
            )
          );
          const likeProfile = {
            username: p.username,
            age: p.age,
            gender: (p as any).gender,
            mood: p.mood,
            photoUrl: p.photoUrl || (p as any).photo || null,
            photos: mergedPhotos,
            location: p.location as any,
          };

          const existing = byUser[key];
          if (existing?.incoming) {
            // Preserve incoming timestamp
            upsertIncoming(
              p.username,
              likeProfile as any,
              existing.incoming.at
            );
          }
          if (existing?.outgoing) {
            setOutgoingProfile(p.username, likeProfile as any);
          }
        }
      } catch (e) {
        // Silent: hydration is best-effort
        console.debug("Hydration fetch failed", e);
      }
    })();
  }, [likesList, myLikesListRaw, byUser, upsertIncoming, setOutgoingProfile]);

  const unreadByGroup = useNotificationStore((s) => s.unreadByGroup);
  // REMOVED: unused totalUnread

  useEffect(() => {
    if (!joined) {
      navigate("/", { replace: true });
      return;
    }
    ensureConnected();

    // Ensure we have groups loaded (so we can filter to joined ones)
    const load = async () => {
      try {
        if (groups.length === 0) {
          const list = await fetchGroups(true);
          setGroups(list);
        }
      } catch (e) {
        console.error("Failed to load groups:", e);
      }
    };
    load();
  }, [joined, ensureConnected, groups.length, setGroups, navigate]);

  // Maintain the CSS var for 100dvh on mobile
  useEffect(() => {
    const updateHeight = () =>
      document.documentElement.style.setProperty(
        "--vh",
        `${window.innerHeight * 0.01}px`
      );
    updateHeight();
    window.addEventListener("resize", updateHeight);
    window.addEventListener("orientationchange", updateHeight);
    if ("ontouchstart" in window)
      window.addEventListener("scroll", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
      window.removeEventListener("orientationchange", updateHeight);
      if ("ontouchstart" in window)
        window.removeEventListener("scroll", updateHeight);
    };
  }, []);

  const handleSelectGroup = (id: string, name: string) => {
    joinGroup(id, name);
    setActiveGroup(id);
    selectGroup(id, name);
    try {
      useNotificationStore.getState().reset(id);
    } catch {}
    navigate("/chat", { replace: true, state: { from: "/inbox" } });
  };

  const joinedGroups = groups.filter((g) => joinedGroupIds.has(g.id));

  return (
    <div
      className="flex flex-col relative bg-white"
      style={{ height: "calc(var(--vh, 1vh) * 100)", overflowX: "hidden" }}
    >
      {/* Single scroll container */}
      <div className="flex-1 overflow-y-auto">
        <div className="h-12">
          <div className="h-12 max-w-md mx-auto px-4 flex items-center">
            <span className="text-base font-semibold text-gray-900">Inbox</span>
          </div>
        </div>

        {/* Static tabs (no sticky/affix behavior) */}
        <TabsRow hasIncomingLikes={showIncomingDot} activeTab={tab} />

        {/* Content area */}
        <div>
          {tab === "general" ? (
            <>
              {joinedGroups.length > 0 ? (
                joinedGroups.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    onClick={() => handleSelectGroup(group.id, group.name)}
                    unreadCount={unreadByGroup[group.id] || 0}
                    borderless
                    nameClassName="text-message" // ← NEW: smaller name just in Inbox
                    marginless
                  />
                ))
              ) : (
                <div className="text-center text-sm text-gray-500 py-16">
                  You haven’t joined any rooms yet.
                </div>
              )}
            </>
          ) : tab === "likes" ? (
            <>
              {!hasMyProfile ? (
                <div className="text-center text-sm text-gray-500 py-16">
                  Create a dating profile to see people who liked you.
                </div>
              ) : likesList.length > 0 ? (
                <div className="max-w-md mx-auto px-4 mt-4">
                  <div className="grid gap-4 place-items-center">
                    {likesList.map((item) => {
                      const name = item.username;
                      const imageUrl =
                        item.incoming?.profile?.photoUrl ||
                        (item.incoming?.profile as any)?.photo ||
                        "/placeholder.jpg";
                      const photosArr = Array.isArray(
                        (item.incoming?.profile as any)?.photos
                      )
                        ? ((item.incoming?.profile as any)
                            ?.photos as string[]) || []
                        : [];
                      const mergedPhotos = Array.from(
                        new Set(
                          [
                            ...photosArr,
                            item.incoming?.profile?.photoUrl,
                            (item.incoming?.profile as any)?.photo,
                          ].filter(Boolean) as string[]
                        )
                      );
                      const city =
                        item.incoming?.profile?.location?.city?.trim();
                      const state =
                        item.incoming?.profile?.location?.state?.trim();
                      const locationLabel =
                        city ||
                        (item.incoming?.profile?.location?.formatted
                          ? item.incoming.profile.location.formatted
                              .split(",")[0]
                              .trim()
                          : "") ||
                        "";
                      const liked = !!byUser[name.toLowerCase()]?.outgoing;

                      return (
                        <DatingCard
                          key={`${name}-${item.incoming!.at}`}
                          name={name}
                          age={item.incoming?.profile?.age}
                          status={item.incoming?.profile?.mood || ""}
                          imageUrl={imageUrl}
                          photos={mergedPhotos}
                          city={city}
                          state={state}
                          locationLabel={locationLabel}
                          liked={liked}
                          onLike={() => likeUser(name)}
                          onUnlike={() => unlikeUser(name)}
                          onWave={() =>
                            navigate(`/dm/${encodeURIComponent(name)}`, {
                              state: { suggest: "wave", from: "/direct" },
                            })
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center text-sm text-gray-500 py-16">
                  No likes yet. When someone likes your dating profile, you’ll
                  see them here.
                </div>
              )}
            </>
          ) : (
            <>
              {!hasMyProfile ? (
                <div className="text-center text-sm text-gray-500 py-16">
                  Create a dating profile to like others.
                </div>
              ) : myLikesList.length > 0 ? (
                <div className="max-w-md mx-auto px-4 mt-4">
                  <div className="grid gap-4 place-items-center">
                    {myLikesList.map((item) => {
                      const name = item.username;
                      const prof = item.outgoing!.profile!; // guaranteed by filter above
                      const imageUrl =
                        prof.photoUrl ||
                        (prof as any).photo ||
                        "/placeholder.jpg"; // usually has real value now
                      const photosArr = Array.isArray((prof as any)?.photos)
                        ? ((prof as any)?.photos as string[]) || []
                        : [];
                      const mergedPhotos = Array.from(
                        new Set(
                          [
                            ...photosArr,
                            prof.photoUrl,
                            (prof as any).photo,
                          ].filter(Boolean) as string[]
                        )
                      );
                      const city = prof.location?.city?.trim();
                      const state = prof.location?.state?.trim();
                      const locationLabel =
                        city ||
                        (prof.location?.formatted
                          ? prof.location.formatted.split(",")[0].trim()
                          : "") ||
                        "";
                      const liked = true;

                      return (
                        <DatingCard
                          key={`${name}-${item.outgoing!.at}`}
                          name={name}
                          age={prof.age}
                          status={prof.mood || ""}
                          imageUrl={imageUrl}
                          photos={mergedPhotos}
                          city={city}
                          state={state}
                          locationLabel={locationLabel}
                          liked={liked}
                          onLike={() => likeUser(name)}
                          onUnlike={() => unlikeUser(name)}
                          onWave={() =>
                            navigate(`/dm/${encodeURIComponent(name)}`, {
                              state: { suggest: "wave", from: "/direct" },
                            })
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center text-sm text-gray-500 py-16">
                  {myLikesListRaw.length > 0
                    ? "Loading liked profiles…"
                    : "You haven’t liked anyone yet."}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default InboxPage;
