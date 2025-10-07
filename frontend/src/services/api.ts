import axios from "axios";
import type { Group, User, DatingProfile } from "../types";

export const API_URL = "http://localhost:8080/api";
export const api = axios.create({ baseURL: API_URL });

export const fetchGroups = async (includeOnline = false): Promise<Group[]> => {
  const res = await api.get<Group[]>(
    `/groups${includeOnline ? "?includeOnline=true" : ""}`
  );
  return res.data;
};

export const fetchGroupById = async (groupId: string): Promise<Group> => {
  const res = await api.get<Group>(`/groups/${groupId}`);
  return res.data;
};

export const createGroup = async (input: {
  id?: string;
  name: string;
  description?: string;
  avatarUrl?: string;
}): Promise<Group> => {
  const res = await api.post<Group>(`/groups`, input);
  return res.data;
};

export const updateGroup = async (
  groupId: string,
  patch: { name?: string; description?: string; avatarUrl?: string }
): Promise<Group> => {
  const res = await api.put<Group>(`/groups/${groupId}`, patch);
  return res.data;
};

export const deleteGroup = async (
  groupId: string
): Promise<{ success: true }> => {
  const res = await api.delete<{ success: true }>(`/groups/${groupId}`);
  return res.data;
};

export const fetchMessagesForGroup = async (groupId: string) => {
  const res = await api.get(`/messages/${groupId}`);
  return res.data;
};

export const fetchOnlineCounts = async (): Promise<Record<string, number>> => {
  const res = await api.get<Record<string, number>>("/groups/online-counts");
  return res.data;
};

// NEW: fetch members (current users in the group)
export const fetchGroupMembers = async (groupId: string): Promise<User[]> => {
  const res = await api.get<User[]>(`/groups/${groupId}/users`);
  return res.data;
};

// Dating APIs
export const fetchDatingProfiles = async (): Promise<DatingProfile[]> => {
  const res = await api.get<DatingProfile[]>("/dating/profiles");
  return res.data;
};

// NEW: fetch one profile by username
export const fetchDatingProfile = async (
  username: string
): Promise<DatingProfile | null> => {
  // Use batch endpoint to avoid 404s and get a consistent 200/[]
  const qs = encodeURIComponent(username);
  const res = await api.get<DatingProfile[]>(
    `/dating/profiles/batch?users=${qs}`
  );
  const list = res.data || [];
  return list[0] || null;
};

// NEW: batch fetch multiple profiles by usernames
export const fetchProfilesByUsernames = async (
  usernames: string[]
): Promise<DatingProfile[]> => {
  const qs = usernames.map(encodeURIComponent).join(",");
  const res = await api.get<DatingProfile[]>(
    `/dating/profiles/batch?users=${qs}`
  );
  return res.data;
};

// Ensure save includes location transparently
export async function saveDatingProfile(
  profile: DatingProfile
): Promise<DatingProfile> {
  const res = await fetch(`${API_URL}/dating/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    throw new Error(`Failed to save dating profile: ${res.status}`);
  }
  return res.json();
}

export async function deleteDatingProfile(
  username: string
): Promise<{ success: true }> {
  const res = await api.delete<{ success: true }>(
    `/dating/profile/${encodeURIComponent(username)}`
  );
  return res.data;
}

// Delete a single photo from user's dating profile; returns updated profile
export async function removeDatingPhoto(
  username: string,
  url: string
): Promise<DatingProfile> {
  const res = await api.delete<DatingProfile>(
    `/dating/profile/${encodeURIComponent(username)}/photo`,
    { params: { url } }
  );
  return res.data;
}

// Upload a dating photo (multipart/form-data); returns { url }
export const uploadDatingPhoto = async (
  file: File,
  username: string
): Promise<{ url: string }> => {
  const form = new FormData();
  form.append("photo", file);
  const res = await api.post<{ url: string }>(
    `/uploads/dating-photo?username=${encodeURIComponent(username)}`,
    form,
    {
      headers: { "Content-Type": "multipart/form-data" },
    }
  );
  return res.data;
};

// NEW: Upload chat media (image or video) -> returns { url, type }
export const uploadChatMedia = async (
  file: File,
  username: string
): Promise<{ url: string; type: string }> => {
  const form = new FormData();
  form.append("media", file);
  const res = await api.post<{ url: string; type: string }>(
    `/uploads/chat-media?username=${encodeURIComponent(username)}`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return res.data;
};

// Upload a group/avatar image -> returns { url }
export const uploadGroupAvatar = async (
  file: File
): Promise<{ url: string; type?: string }> => {
  const form = new FormData();
  form.append("avatar", file);
  const res = await api.post<{ url: string; type?: string }>(
    `/uploads/avatar`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return res.data;
};

// Cloudinary configuration status
export const fetchCloudinaryStatus = async (): Promise<{
  configured: boolean;
  usingUrl?: boolean;
  cloudName?: string;
}> => {
  const res = await api.get(`/cloudinary/status`);
  return res.data || { configured: false };
};

// --- Social Links ---
export type SocialType = "facebook" | "twitter" | "tiktok";
export type LinkedAccount = { id: string; type: SocialType; url: string };

export async function fetchSocialLinksById(
  userId: string,
  legacyUsername?: string
): Promise<LinkedAccount[]> {
  const qs = legacyUsername
    ? `?legacy=${encodeURIComponent(legacyUsername)}`
    : "";
  const res = await api.get<LinkedAccount[]>(
    `/users/id/${encodeURIComponent(userId)}/social-links${qs}`
  );
  return res.data || [];
}

export async function saveSocialLinksById(
  userId: string,
  links: LinkedAccount[]
): Promise<LinkedAccount[]> {
  const res = await api.put<LinkedAccount[]>(
    `/users/id/${encodeURIComponent(userId)}/social-links`,
    links
  );
  return res.data || [];
}

export async function migrateSocialLinks(
  from: string,
  to: string
): Promise<void> {
  await api.post(`/users/migrate-social-links`, { from, to });
}

// For viewing other users by username (legacy route)
export async function fetchSocialLinksForUsername(
  username: string
): Promise<LinkedAccount[]> {
  const res = await api.get<LinkedAccount[]>(
    `/users/${encodeURIComponent(username)}/social-links`
  );
  return res.data || [];
}

// --- User Bio (by userId) ---
export async function fetchUserBioById(userId: string): Promise<string> {
  const res = await api.get<{ bio: string }>(
    `/users/id/${encodeURIComponent(userId)}/bio`
  );
  return res.data?.bio || "";
}

export async function saveUserBioById(
  userId: string,
  bio: string
): Promise<string> {
  const res = await api.put<{ bio: string }>(
    `/users/id/${encodeURIComponent(userId)}/bio`,
    { bio }
  );
  return res.data?.bio || "";
}

// Resolve userId by username (online users only)
export async function resolveUserIdByUsername(
  username: string
): Promise<string | null> {
  try {
    const res = await api.get<{ userId: string }>(
      `/users/resolve-id/${encodeURIComponent(username)}`
    );
    return res.data?.userId || null;
  } catch {
    return null;
  }
}

// Normalize and validate social URLs
export function normalizeSocialUrl(type: SocialType, input: string): string {
  const raw = (input || "").trim();
  if (!raw) return raw;

  const handle = raw.startsWith("@") ? raw.slice(1) : raw;
  const toHttps = (u: string) => (u.startsWith("http") ? u : `https://${u}`);

  switch (type) {
    case "facebook": {
      if (/^(https?:)?\/\/(www\.)?(facebook\.com|fb\.com)\//i.test(raw)) {
        return toHttps(raw.replace(/^https?:\/\//i, "https://"));
      }
      return `https://facebook.com/${handle}`;
    }
    case "twitter": {
      if (/^(https?:)?\/\/(www\.)?(x\.com|twitter\.com)\//i.test(raw)) {
        return toHttps(raw.replace(/^https?:\/\//i, "https://"));
      }
      return `https://x.com/${handle}`;
    }
    case "tiktok": {
      if (/^(https?:)?\/\/(www\.)?tiktok\.com\//i.test(raw)) {
        return toHttps(raw.replace(/^https?:\/\//i, "https://"));
      }
      return `https://www.tiktok.com/@${handle}`;
    }
    default:
      return raw;
  }
}

export function isAllowedSocialHost(
  type: SocialType,
  urlString: string
): boolean {
  try {
    const u = new URL(urlString);
    const host = u.hostname.toLowerCase();
    if (type === "facebook") return /(facebook\.com|fb\.com)$/.test(host);
    if (type === "twitter") return /(x\.com|twitter\.com)$/.test(host);
    if (type === "tiktok") return /tiktok\.com$/.test(host);
    return false;
  } catch {
    return false;
  }
}
