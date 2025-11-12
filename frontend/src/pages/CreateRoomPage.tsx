import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createGroup,
  deleteGroup,
  uploadGroupAvatar,
  fetchCloudinaryStatus,
} from "../services/api";
import { useGroupStore } from "../stores/groupStore";
import { useSocketStore } from "../stores/socketStore";
import { useMessageStore } from "../stores/messageStore";
import type { Group } from "../types";
import { toSlug, generateUniqueId } from "../utils/random";

const CreateRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const { groups, setGroups, selectGroup, currentGroup, clearCurrentGroup } =
    useGroupStore();
  const {
    joinGroup,
    setActiveGroup,
    leaveGroup,
    joinedGroupIds,
    activeGroupId,
  } = useSocketStore();
  const { clearThread } = useMessageStore();

  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [cloudinaryReady, setCloudinaryReady] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestId = (val: string) => toSlug(val);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const groupName = name.trim();
    let groupId = (id || suggestId(name)).trim();
    if (!groupName || !groupId) {
      setError("Room name is required");
      return;
    }
    // Auto-resolve collisions by generating a unique id
    if (groups.some((g) => g.id === groupId)) {
      const existingIds = groups.map((g) => g.id);
      const base = toSlug(groupName) || "room";
      groupId = generateUniqueId(existingIds, 8, base);
    }
    setSubmitting(true);
    try {
      const saved = await createGroup({
        id: groupId,
        name: groupName,
        description: description || undefined,
        ...(avatarUrl ? { avatarUrl } : {}),
      });
      setGroups([...groups, saved]);
      selectGroup(saved.id, saved.name);
      joinGroup(saved.id, saved.name);
      setActiveGroup(saved.id);
      navigate(`/chat/${saved.databaseId || saved.id}`, {
        replace: true,
        state: { from: "/" },
      });
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || String(e);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const onAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      const { url } = await uploadGroupAvatar(file);
      setAvatarUrl(url);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || String(err);
      setAvatarError(msg);
    } finally {
      setAvatarUploading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const s = await fetchCloudinaryStatus();
        if (mounted) setCloudinaryReady(Boolean(s?.configured));
      } catch {
        if (mounted) setCloudinaryReady(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleDelete = async (group: Group) => {
    const ok = window.confirm(
      `Delete room "${group.name}"? This will also remove its messages.`
    );
    if (!ok) return;
    try {
      await deleteGroup(group.id);
      // If currently active or joined, leave it
      if (joinedGroupIds.has(group.id)) {
        leaveGroup(group.id);
      }
      // Clear messages thread locally
      try {
        clearThread(group.id);
      } catch {}
      // Remove from groups list
      setGroups(groups.filter((g) => g.id !== group.id));
      // If this was the current/active group, clear selection and navigate
      if (currentGroup?.id === group.id || activeGroupId === group.id) {
        clearCurrentGroup();
        navigate("/", { replace: true });
      }
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || String(e));
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-md mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Create a room</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!id) setId(suggestId(e.target.value));
              }}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="e.g. Football Fans"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Room ID
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={id}
                onChange={(e) => setId(suggestId(e.target.value))}
                className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="e.g. football-fans"
              />
              <button
                type="button"
                className="px-3 py-2 rounded-md border text-sm text-gray-700"
                onClick={() => {
                  const existingIds = groups.map((g) => g.id);
                  const base = toSlug(name) || "room";
                  setId(generateUniqueId(existingIds, 8, base));
                }}
              >
                Random
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Lowercase letters, numbers and dashes only.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="What’s this room about?"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Room avatar (optional)
            </label>
            <div className="mt-1 flex items-center gap-3">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Room avatar preview"
                  className="h-12 w-12 rounded-full object-cover ring-1 ring-gray-200"
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-gray-200 ring-1 ring-gray-200" />
              )}
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center px-3 py-2 rounded-md border cursor-pointer text-sm text-gray-700 bg-white">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={!cloudinaryReady || avatarUploading}
                    onChange={onAvatarSelected}
                  />
                  {avatarUploading
                    ? "Uploading…"
                    : cloudinaryReady
                    ? "Upload"
                    : "Upload (disabled)"}
                </label>
                {avatarUrl && (
                  <button
                    type="button"
                    className="text-sm text-gray-500 hover:text-gray-700"
                    onClick={() => setAvatarUrl(null)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {avatarError && (
              <div className="mt-1 text-sm text-red-600">{avatarError}</div>
            )}
            {!cloudinaryReady && (
              <div className="mt-1 text-xs text-amber-600">
                Media uploads are disabled because Cloudinary isn’t configured
                on the server.
              </div>
            )}
            <p className="mt-1 text-xs text-gray-500">
              JPG, PNG, WebP, GIF, AVIF, or SVG up to 5MB.
            </p>
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 rounded-md bg-[#FD1D1D] text-white font-semibold disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create room"}
          </button>
        </form>
        {/* Existing rooms list */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-3">Existing rooms</h2>
          {groups.length === 0 ? (
            <div className="text-sm text-gray-500">No rooms yet.</div>
          ) : (
            <ul className="divide-y border rounded-md bg-white">
              {groups.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <div className="min-w-0 flex items-center gap-3">
                    {g.avatarUrl ? (
                      <img
                        src={g.avatarUrl}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover ring-1 ring-gray-200 flex-shrink-0"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-gray-200 ring-1 ring-gray-200 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">
                        {g.name}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {g.id}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigate(`/chat/${g.databaseId || g.id}`, {
                          state: {
                            from: "/create-room",
                          },
                        });
                      }}
                      className="text-sm px-3 py-1 rounded-md border text-gray-700"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(g)}
                      className="text-sm px-3 py-1 rounded-md bg-red-50 text-red-700 hover:bg-red-100"
                    >
                      Delete
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

export default CreateRoomPage;
