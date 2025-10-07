import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import GroupCard from "../components/common/GroupCard";
import FloatingActionButton from "../components/common/FloatingActionButton";
import { useAuthStore } from "../stores/authStore";
import { useGroupStore } from "../stores/groupStore";
import { useSocketStore } from "../stores/socketStore";
import {
  fetchGroups,
  fetchOnlineCounts,
  fetchGroupMembers,
  fetchGroupById,
} from "../services/api";
import type { User as Member } from "../types";

const REFRESH_INTERVAL_MS = 15000;

const GroupsPage: React.FC = () => {
  const navigate = useNavigate();
  // Keep only what is used
  const { joined } = useAuthStore();
  const { groups, setGroups, selectGroup, mergeOnlineCounts, currentGroup } =
    useGroupStore();
  const { ensureConnected, joinGroup, setActiveGroup, joinedGroupIds } =
    useSocketStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const pollTimer = useRef<number | null>(null);

  const [membersByGroup, setMembersByGroup] = useState<
    Record<string, Member[]>
  >({});

  useEffect(() => {
    if (!joined) {
      navigate("/", { replace: true });
      return;
    }
    ensureConnected();

    const load = async () => {
      try {
        // Always refresh the groups list to avoid stale rooms after server restart/deletes
        const list = await fetchGroups(true);
        setGroups(list);
        // Also update online counts if available (optional; counts may be included above)
        try {
          const counts = await fetchOnlineCounts();
          mergeOnlineCounts(counts);
        } catch {}
      } catch (e) {
        console.error("Failed to load groups:", e);
      }
    };

    load();
    pollTimer.current = window.setInterval(load, REFRESH_INTERVAL_MS);

    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, [
    joined,
    navigate,
    ensureConnected,
    setGroups,
    groups.length,
    mergeOnlineCounts,
  ]);

  useEffect(() => {
    if (!joined || groups.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          groups.map(async (g) => {
            try {
              const members = await fetchGroupMembers(g.id);
              return [g.id, members] as const;
            } catch {
              return [g.id, [] as Member[]] as const;
            }
          })
        );
        if (cancelled) return;
        setMembersByGroup((prev) => {
          const next: Record<string, Member[]> = { ...prev };
          for (const [id, arr] of results) next[id] = arr;
          return next;
        });
      } catch (e) {
        if (!cancelled) console.error("Failed to fetch group members:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [joined, groups]);

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

  const handleSelectGroup = async (id: string, name: string) => {
    // Verify the room still exists on the server before attempting to join
    try {
      await fetchGroupById(id);
    } catch {
      try {
        // Refresh list to reflect server state
        const list = await fetchGroups(true);
        setGroups(list);
      } catch {}
      if (typeof window !== "undefined") {
        window.alert(
          "This room no longer exists. The list has been refreshed."
        );
      }
      return;
    }

    joinGroup(id, name);
    setActiveGroup(id);
    selectGroup(id, name);
    navigate("/chat", { replace: true, state: { from: "/groups" } });
  };

  useEffect(() => {
    if (!joined) return;
    ensureConnected();
    if (currentGroup) {
      // Confirm currentGroup still exists; if not, clear it
      (async () => {
        try {
          await fetchGroupById(currentGroup.id);
          if (!joinedGroupIds.has(currentGroup.id)) {
            joinGroup(currentGroup.id, currentGroup.name);
          }
          setActiveGroup(currentGroup.id);
        } catch {
          // Clear invalid selection
          try {
            useGroupStore.getState().setCurrentGroup(null);
          } catch {}
        }
      })();
    }
  }, [
    joined,
    currentGroup,
    joinedGroupIds,
    ensureConnected,
    joinGroup,
    setActiveGroup,
  ]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col w-full relative bg-gray-50"
      style={{ height: "calc(var(--vh, 1vh) * 100)", overflowX: "hidden" }}
    >
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {groups.map((group) => {
          const members = membersByGroup[group.id] || [];
          const avatars = members.slice(0, 3).map((m) => m.avatar ?? null);
          const total = members.length;
          const isJoined = joinedGroupIds.has(group.id);
          return (
            <GroupCard
              key={group.id}
              group={group}
              onClick={() => handleSelectGroup(group.id, group.name)}
              useLatestPreview={false}
              showBadge={false}
              membersAvatars={avatars}
              membersTotal={total}
              joined={isJoined}
            />
          );
        })}
      </div>

      {/* Floating Action Button: Create Room */}
      <FloatingActionButton
        ariaLabel="Create room"
        onClick={() => navigate("/create-room")}
      />
    </div>
  );
};

export default GroupsPage;
