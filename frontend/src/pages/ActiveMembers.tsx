import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import { useAuthStore } from "../stores/authStore";
import { useGroupStore } from "../stores/groupStore";
import { usePresenceStore } from "../stores/presenceStore";

const ActiveMembers: React.FC = () => {
  const navigate = useNavigate();
  const { joined } = useAuthStore();
  const { currentGroup, onlineUsers } = useGroupStore();
  const isOnline = usePresenceStore((s) => s.isOnline);

  const handleViewProfile = (username?: string) => {
    const u = (username || "").trim();
    if (!u) return;
    navigate(`/u/${encodeURIComponent(u)}`);
  };

  // Guard: must be joined and have an active group
  useEffect(() => {
    if (!joined) {
      navigate("/", { replace: true });
      return;
    }
    if (!currentGroup) {
      navigate("/groups", { replace: true });
    }
  }, [joined, currentGroup, navigate]);

  const members = (Array.isArray(onlineUsers) ? onlineUsers : []).filter(
    (u: any) => isOnline(u?.username)
  );
  const count = members.length;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 border-b">
        <div className="max-w-md mx-auto flex items-center justify-between gap-2 px-4 h-14">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Back"
              className="text-gray-900 focus:outline-none"
            >
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-base font-semibold text-gray-900 truncate">
              Active users
            </h1>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto w-full px-4 py-4">
          {count === 0 ? (
            <div className="text-center text-gray-500 text-sm py-10">
              No active members.
            </div>
          ) : (
            <ul className="space-y-3">
              {members.map((m) => (
                <li key={m.username} className="flex items-center gap-3">
                  <div className="relative">
                    {m.avatar ? (
                      <img
                        src={m.avatar}
                        alt={`${m.username}'s avatar`}
                        className="w-10 h-10 rounded-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-sm font-semibold">
                        {m.username?.[0]?.toUpperCase() || "?"}
                      </div>
                    )}
                    {/* Online dot */}
                    <span
                      className="absolute  bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 ring-2 ring-white"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => handleViewProfile(m.username)}
                      className="text-left text-sm font-medium text-gray-900 truncate focus:outline-none"
                      aria-label={`View ${m.username}'s profile`}
                    >
                      {m.username}
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

export default ActiveMembers;
