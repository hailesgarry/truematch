import axios from "axios";
import type { AxiosProgressEvent } from "axios";
import type {
  Group,
  DatingProfile,
  DatingProfileUpsert,
  Message,
  UserReaction,
} from "../types";
// Auth / Profile types
export interface UserProfile {
  userId: string;
  username: string;
  avatarUrl?: string | null;
  friends: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AuthTokenResponse {
  token: string;
  profile: UserProfile;
}

// Prefer Vite env vars if provided; default to local dev ports
export const API_URL =
  import.meta.env.VITE_API_URL?.toString() || "http://localhost:8080/api";
export const PY_API_URL =
  import.meta.env.VITE_PY_API_URL?.toString() || "http://localhost:8081/api";

// Legacy Node/Express service (uploads, sockets, presence)
export const api = axios.create({ baseURL: API_URL, timeout: 15000 });
// Python FastAPI service (primary data APIs)
export const pythonApi = axios.create({ baseURL: PY_API_URL, timeout: 15000 });

// Lightweight retry for idempotent GET requests on transient timeouts
function attachGetTimeoutRetry(instance: typeof axios) {
  // Note: axios instances share interceptors via instance.interceptors
  (instance as any).interceptors ??= axios.interceptors;
  (instance as any).interceptors.response.use(
    (res: any) => res,
    async (error: any) => {
      const cfg = error?.config || {};
      const method = (cfg.method || "").toString().toLowerCase();
      const isTimeout =
        error?.code === "ECONNABORTED" ||
        /timeout/i.test(String(error?.message || ""));
      const shouldRetry =
        method === "get" && isTimeout && (cfg.__retryCount || 0) < 2;
      if (shouldRetry) {
        cfg.__retryCount = (cfg.__retryCount || 0) + 1;
        const backoffMs = 300 * cfg.__retryCount; // 300ms, 600ms
        await new Promise((r) => setTimeout(r, backoffMs));
        return (instance as any)(cfg);
      }
      return Promise.reject(error);
    }
  );
}

attachGetTimeoutRetry(api as any);
attachGetTimeoutRetry(pythonApi as any);

// ...existing code...

// ---------------- Unauthorized (401) handler ----------------
// Allow consumers (auth store) to register a single handler invoked on 401s
let onUnauthorized: (() => void) | null = null;
export function registerUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

pythonApi.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status || error?.status;
    const cfg = error?.config || {};
    const url: string = (cfg.url || "").toString();
    const headers: any = cfg.headers || {};
    const hasAuthHeader = Boolean(
      headers.Authorization || headers.authorization
    );
    const isAuthEndpoint =
      url.startsWith("/auth/login") || url.startsWith("/auth/signup");
    // Only auto-logout if the request was authenticated and it's not a login/signup call
    if (status === 401 && hasAuthHeader && !isAuthEndpoint) {
      try {
        onUnauthorized?.();
      } catch {}
    }
    return Promise.reject(error);
  }
);

export const fetchGroups = async (includeOnline = false): Promise<Group[]> => {
  const res = await pythonApi.get<{
    groups: any[];
    total: number;
    hasMore: boolean;
  }>("/groups", {
    params: includeOnline ? { includeOnline: "true" } : undefined,
  });
  const groups = Array.isArray(res.data?.groups) ? res.data.groups : [];
  return groups.map(normalizeGroup);
};

export const fetchGroupsFromApi = async (): Promise<Group[]> => {
  const res = await pythonApi.get<{
    groups?: any[];
    total?: number;
    hasMore?: boolean;
  }>("/groups", {
    params: {
      includeOnline: "true",
      includeMembers: "true",
      membersLimit: 5,
    },
  });
  const groupsPayload = Array.isArray(res.data?.groups)
    ? res.data?.groups
    : Array.isArray(res.data)
    ? (res.data as any[])
    : [];
  return groupsPayload.map(normalizeGroup);
};

export const fetchGroupById = async (groupId: string): Promise<Group> => {
  const res = await pythonApi.get<Group>(`/groups/${groupId}`);
  return normalizeGroup(res.data);
};

export const createGroup = async (input: {
  id?: string;
  name: string;
  description?: string;
  avatarUrl?: string;
}): Promise<Group> => {
  const res = await pythonApi.post<Group>(`/groups`, input);
  return normalizeGroup(res.data);
};

export const updateGroup = async (
  groupId: string,
  patch: {
    name?: string;
    description?: string;
    avatarUrl?: string | null;
  }
): Promise<Group> => {
  const res = await pythonApi.put<Group>(`/groups/${groupId}`, patch);
  return normalizeGroup(res.data);
};

export const deleteGroup = async (
  groupId: string
): Promise<{ success: true }> => {
  const res = await pythonApi.delete<{ success: true }>(`/groups/${groupId}`);
  return res.data;
};

function coerceNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeGroup(group: any): Group {
  if (!group) return group as Group;
  const id = typeof group.id === "string" ? group.id.trim() : "";
  const name = typeof group.name === "string" ? group.name : "";
  const description =
    typeof group.description === "string" ? group.description : "";
  const databaseId =
    typeof group.databaseId === "string" && group.databaseId.trim()
      ? group.databaseId.trim()
      : undefined;
  const slug =
    typeof group.slug === "string" && group.slug.trim()
      ? group.slug.trim()
      : undefined;

  const avatarUrlRaw =
    typeof group.avatarUrl === "string"
      ? group.avatarUrl
      : typeof group.thumbnail === "string"
      ? group.thumbnail
      : undefined;
  const thumbnail =
    typeof group.thumbnail === "string"
      ? group.thumbnail
      : avatarUrlRaw ?? null;

  const normalized: Group = {
    id,
    name,
    description,
    avatarUrl: avatarUrlRaw ?? null,
    databaseId,
    slug: slug || id,
    onlineCount: coerceNumber(group.onlineCount),
    thumbnail,
  };

  if (group.memberCount === null) {
    normalized.memberCount = null;
  } else {
    const memberCount = coerceNumber(group.memberCount);
    if (memberCount !== undefined) normalized.memberCount = memberCount;
  }

  if (Array.isArray(group.memberPreview)) {
    const preview = group.memberPreview
      .map((item: any) => {
        const username =
          typeof item?.username === "string" ? item.username : "";
        if (!username) return null;
        return {
          username,
          avatar:
            item?.avatar === null
              ? null
              : typeof item?.avatar === "string"
              ? item.avatar
              : null,
          userId:
            typeof item?.userId === "string" && item.userId.trim()
              ? item.userId
              : null,
        };
      })
      .filter(Boolean) as NonNullable<Group["memberPreview"]>;
    if (preview.length) normalized.memberPreview = preview;
  }

  const rawSummary =
    group.lastMessagePreview && typeof group.lastMessagePreview === "object"
      ? group.lastMessagePreview
      : null;
  if (rawSummary) {
    const createdAt =
      rawSummary.createdAt === null
        ? null
        : coerceNumber(rawSummary.createdAt) ?? undefined;
    normalized.lastMessagePreview = {
      username:
        typeof rawSummary.username === "string"
          ? rawSummary.username
          : undefined,
      text: typeof rawSummary.text === "string" ? rawSummary.text : undefined,
      previewText:
        typeof rawSummary.previewText === "string"
          ? rawSummary.previewText
          : undefined,
      voiceNote:
        typeof rawSummary.voiceNote === "boolean"
          ? rawSummary.voiceNote
          : undefined,
      kind:
        typeof rawSummary.kind === "string" || rawSummary.kind === null
          ? rawSummary.kind
          : undefined,
      createdAt: createdAt ?? null,
      hasMedia:
        typeof rawSummary.hasMedia === "boolean"
          ? rawSummary.hasMedia
          : undefined,
      mediaType:
        typeof rawSummary.mediaType === "string" ||
        rawSummary.mediaType === null
          ? rawSummary.mediaType
          : undefined,
      audioDurationMs:
        rawSummary.audioDurationMs === null
          ? null
          : coerceNumber(rawSummary.audioDurationMs),
    };
  } else {
    normalized.lastMessagePreview = null;
  }

  const lastMessageAt =
    group.lastMessageAt === null
      ? null
      : coerceNumber(group.lastMessageAt) ?? undefined;
  if (lastMessageAt !== undefined) normalized.lastMessageAt = lastMessageAt;
  else if (normalized.lastMessagePreview?.createdAt != null) {
    normalized.lastMessageAt = normalized.lastMessagePreview.createdAt;
  }

  const lastActiveAt =
    group.lastActiveAt === null
      ? null
      : coerceNumber(group.lastActiveAt) ?? undefined;
  if (lastActiveAt !== undefined) normalized.lastActiveAt = lastActiveAt;
  else if (normalized.lastMessageAt != null) {
    normalized.lastActiveAt = normalized.lastMessageAt;
  }

  const summaryFetchedAt = coerceNumber(group.summaryFetchedAt);
  if (summaryFetchedAt !== undefined)
    normalized.summaryFetchedAt = summaryFetchedAt;

  return normalized;
}

export type MessageFilterItem = {
  groupId: string;
  username: string;
  normalized?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type MessageFilterResponse = {
  userId: string;
  items: MessageFilterItem[];
  groups: Record<string, string[]>;
};

export const fetchMessageFilters = async (
  userId: string
): Promise<MessageFilterResponse> => {
  const res = await pythonApi.get<MessageFilterResponse>(
    `/users/${encodeURIComponent(userId)}/message-filters`
  );
  return res.data;
};

export const addMessageFilter = async (
  userId: string,
  payload: { groupId: string; username: string }
): Promise<MessageFilterResponse> => {
  const res = await pythonApi.post<MessageFilterResponse>(
    `/users/${encodeURIComponent(userId)}/message-filters`,
    payload
  );
  return res.data;
};

export const removeMessageFilter = async (
  userId: string,
  payload: { groupId: string; username: string }
): Promise<MessageFilterResponse> => {
  const res = await pythonApi.delete<MessageFilterResponse>(
    `/users/${encodeURIComponent(userId)}/message-filters`,
    { data: payload }
  );
  return res.data;
};

type LatestGroupMessagesOptions = {
  count?: number;
  signal?: AbortSignal;
};

const coerceTimestamp = (value: unknown): string => {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Backwards compatibility: allow epoch seconds/milliseconds
    const numeric = value < 1_000_000_000_000 ? value * 1000 : value;
    return String(Math.trunc(numeric));
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return "";
};

const normalizeMessage = (raw: unknown): Message => {
  if (!raw || typeof raw !== "object") {
    return {
      username: "",
      text: "",
      timestamp: "",
      reactions: {},
    } as Message;
  }

  const source = raw as Record<string, unknown>;

  const reactions: Record<string, UserReaction> | undefined =
    typeof source.reactions === "object" && source.reactions !== null
      ? (source.reactions as Record<string, UserReaction>)
      : undefined;

  const base: Message = {
    ...(source as Message),
    username: typeof source.username === "string" ? source.username : "",
    text: typeof source.text === "string" ? source.text || "" : "",
    timestamp: coerceTimestamp(source.timestamp),
    reactions: reactions,
  };

  if (!base.timestamp) {
    const fallbackTimestamp =
      coerceTimestamp(source.createdAt) || coerceTimestamp(source.created_at);
    base.timestamp = fallbackTimestamp;
  }

  if (!base.reactions) {
    base.reactions = {};
  }

  if (base.replyTo && typeof base.replyTo === "object") {
    base.replyTo = {
      ...(base.replyTo as Record<string, unknown>),
      text:
        typeof (base.replyTo as Record<string, unknown>).text === "string"
          ? ((base.replyTo as Record<string, unknown>).text as string)
          : "",
      username:
        typeof (base.replyTo as Record<string, unknown>).username === "string"
          ? ((base.replyTo as Record<string, unknown>).username as string)
          : "",
    } as Message["replyTo"];
  }

  return base;
};

export const fetchLatestGroupMessages = async (
  groupId: string,
  options: LatestGroupMessagesOptions = {}
): Promise<Message[]> => {
  const trimmed = groupId.trim();
  if (!trimmed) return [];

  const params =
    typeof options.count === "number" && Number.isFinite(options.count)
      ? { count: Math.max(1, Math.trunc(options.count)) }
      : undefined;

  const res = await pythonApi.get<Message[]>(
    `/messages/${encodeURIComponent(trimmed)}/latest`,
    {
      params,
      signal: options.signal,
    }
  );

  const payload = Array.isArray(res.data) ? res.data : [];
  return payload.map(normalizeMessage);
};

// ---------------- Auth & Profiles ----------------
export async function signup(
  username: string,
  password: string,
  avatarUrl?: string | null
): Promise<AuthTokenResponse> {
  const res = await pythonApi.post<AuthTokenResponse>("/auth/signup", {
    username,
    password,
    avatarUrl,
  });
  return res.data;
}

export async function login(
  username: string,
  password: string
): Promise<AuthTokenResponse> {
  const res = await pythonApi.post<AuthTokenResponse>("/auth/login", {
    username,
    password,
  });
  return res.data;
}

export async function fetchMyProfile(token: string): Promise<UserProfile> {
  const res = await pythonApi.get<UserProfile>("/profiles/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export async function fetchProfileByUsername(
  username: string
): Promise<UserProfile | null> {
  try {
    const res = await pythonApi.get<UserProfile>(
      `/profiles/${encodeURIComponent(username)}`
    );
    return res.data;
  } catch {
    return null;
  }
}

export async function fetchProfileById(
  userId: string
): Promise<UserProfile | null> {
  try {
    const res = await pythonApi.get<UserProfile>(
      `/profiles/id/${encodeURIComponent(userId)}`
    );
    return res.data;
  } catch {
    return null;
  }
}

// Patch my profile (avatarUrl and/or friends) using bearer token
export type ProfilePatch = {
  username?: string;
  avatarUrl?: string | null;
  friends?: string[];
};
export async function updateMyProfile(
  token: string,
  patch: ProfilePatch
): Promise<UserProfile> {
  const res = await pythonApi.patch<UserProfile>("/profiles/me", patch, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

// Upload a user avatar; returns { url, type }
export const uploadAvatar = async (
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ url: string; type: string }> => {
  const form = new FormData();
  form.append("avatar", file);
  const res = await pythonApi.post<{ url: string; type: string }>(
    "/uploads/avatar",
    form,
    {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (evt: AxiosProgressEvent) => {
        if (!onProgress) return;
        const total = evt.total || 0;
        if (total > 0) {
          const loaded = evt.loaded || 0;
          const pct = Math.round((loaded / total) * 100);
          onProgress(pct);
        }
      },
    }
  );
  return res.data;
};

// Dating APIs
export const fetchDatingProfiles = async (options?: {
  timeoutMs?: number;
  viewer?: string;
}): Promise<DatingProfile[]> => {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const viewer =
    typeof options?.viewer === "string" ? options.viewer : undefined;
  const res = await pythonApi.get<DatingProfile[]>("/dating/profiles", {
    timeout: timeoutMs,
    params: viewer ? { viewer } : undefined,
  });
  return res.data || [];
};

type DatingProfileLookup = {
  userId?: string | null;
  username?: string | null;
};

const fetchDatingProfilesBatch = async (options: {
  usernames?: string[];
  userIds?: string[];
}): Promise<DatingProfile[]> => {
  const usernames = Array.isArray(options.usernames)
    ? options.usernames.filter(
        (value) => typeof value === "string" && value.trim()
      )
    : [];
  const userIds = Array.isArray(options.userIds)
    ? options.userIds.filter(
        (value) => typeof value === "string" && value.trim()
      )
    : [];

  if (!usernames.length && !userIds.length) {
    return [];
  }

  const params: string[] = [];
  if (usernames.length) {
    const encodedUsers = usernames.map((value) =>
      encodeURIComponent(value.trim())
    );
    params.push(`users=${encodedUsers.join(",")}`);
  }
  if (userIds.length) {
    const encodedIds = userIds.map((value) => encodeURIComponent(value.trim()));
    params.push(`ids=${encodedIds.join(",")}`);
  }

  const res = await pythonApi.get<DatingProfile[]>(
    `/dating/profiles/batch?${params.join("&")}`
  );
  return res.data || [];
};

export const fetchDatingProfile = async (
  lookup: DatingProfileLookup
): Promise<DatingProfile | null> => {
  const userId = typeof lookup.userId === "string" ? lookup.userId.trim() : "";
  const username =
    typeof lookup.username === "string" ? lookup.username.trim() : "";

  if (!userId && !username) {
    return null;
  }

  const list = await fetchDatingProfilesBatch(
    userId ? { userIds: [userId] } : { usernames: [username] }
  );
  return list[0] || null;
};

export const fetchProfilesByUsernames = async (
  usernames: string[]
): Promise<DatingProfile[]> => {
  return fetchDatingProfilesBatch({ usernames });
};

export const fetchProfilesByUserIds = async (
  userIds: string[]
): Promise<DatingProfile[]> => {
  return fetchDatingProfilesBatch({ userIds });
};

type LikesReceivedApiResponse = {
  liked_me?: Array<{
    user_id?: string | null;
    username?: string | null;
    name?: string | null;
    avatar?: string | null;
    profile_avatar?: string | null;
    dating_photo?: string | null;
    dating_photos?: string[] | null;
    has_dating_profile?: boolean | null;
    liked_at?: number | string | null;
  }>;
};

type MatchesApiResponse = {
  matches?: Array<{
    user_id?: string | null;
    username?: string | null;
    name?: string | null;
    avatar?: string | null;
    profile_avatar?: string | null;
    dating_photo?: string | null;
    dating_photos?: string[] | null;
    has_dating_profile?: boolean | null;
    liked_at?: number | string | null;
    matched_at?: number | string | null;
  }>;
};

const toEpochMillis = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return Math.trunc(numeric);
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
};

export type LikeSummary = {
  userId: string;
  username?: string;
  name?: string;
  avatar?: string | null;
  profileAvatar?: string | null;
  datingPhoto?: string | null;
  datingPhotos?: string[] | null;
  hasDatingProfile?: boolean;
  likedAt?: number | null;
  matchedAt?: number | null;
};

const normalizeLikeSummary = (raw: any): LikeSummary | null => {
  if (!raw || typeof raw !== "object") return null;
  const rawUserId = typeof raw.user_id === "string" ? raw.user_id.trim() : "";
  const rawUsername =
    typeof raw.username === "string" ? raw.username.trim() : "";
  const fallbackId = rawUserId || rawUsername;
  if (!fallbackId) return null;
  const likedAt = toEpochMillis(raw.liked_at);
  const matchedAt = toEpochMillis(raw.matched_at);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const profileAvatarRaw =
    typeof raw.profile_avatar === "string" ? raw.profile_avatar.trim() : "";
  const legacyAvatarRaw =
    typeof raw.avatar === "string" ? raw.avatar.trim() : "";
  const datingPhotoRaw =
    typeof raw.dating_photo === "string" ? raw.dating_photo.trim() : "";
  const datingPhotosList: string[] = [];
  if (Array.isArray(raw.dating_photos)) {
    for (const entry of raw.dating_photos as unknown[]) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      if (!trimmed || datingPhotosList.includes(trimmed)) continue;
      datingPhotosList.push(trimmed);
      if (datingPhotosList.length >= 12) break;
    }
  }
  const resolvedDatingPhoto =
    datingPhotoRaw || (datingPhotosList.length ? datingPhotosList[0] : "");
  const hasDatingProfile =
    typeof raw.has_dating_profile === "boolean"
      ? raw.has_dating_profile
      : undefined;
  const profileAvatar = profileAvatarRaw || legacyAvatarRaw || "";
  return {
    userId: fallbackId,
    username: rawUsername || undefined,
    name: name || undefined,
    avatar: profileAvatar || null,
    profileAvatar: profileAvatar || null,
    datingPhoto: resolvedDatingPhoto || null,
    datingPhotos: datingPhotosList.length ? datingPhotosList : null,
    hasDatingProfile,
    likedAt: likedAt ?? null,
    matchedAt: matchedAt ?? null,
  };
};

export type LikeActionResponse = {
  status: "ok";
  isMatch: boolean;
};

export type LikeRemovalResponse = {
  status: "ok";
  removed: boolean;
};

export async function fetchLikesReceived(
  token: string,
  options?: { signal?: AbortSignal }
): Promise<LikeSummary[]> {
  const auth = token?.trim();
  if (!auth) throw new Error("auth token required");
  const res = await pythonApi.get<LikesReceivedApiResponse>("/likes/me", {
    headers: { Authorization: `Bearer ${auth}` },
    signal: options?.signal,
  });
  const list = Array.isArray(res.data?.liked_me) ? res.data.liked_me : [];
  return list
    .map((item) => normalizeLikeSummary(item))
    .filter((item): item is LikeSummary => Boolean(item));
}

export async function fetchMatches(
  token: string,
  options?: { signal?: AbortSignal }
): Promise<LikeSummary[]> {
  const auth = token?.trim();
  if (!auth) throw new Error("auth token required");
  const res = await pythonApi.get<MatchesApiResponse>("/likes/matches", {
    headers: { Authorization: `Bearer ${auth}` },
    signal: options?.signal,
  });
  const list = Array.isArray(res.data?.matches) ? res.data.matches : [];
  return list
    .map((item) => normalizeLikeSummary(item))
    .filter((item): item is LikeSummary => Boolean(item));
}

export async function createDatingLike(
  targetUserId: string,
  token: string
): Promise<LikeActionResponse> {
  const trimmed = targetUserId?.trim();
  if (!trimmed) throw new Error("target_user_id is required");
  const auth = token?.trim();
  if (!auth) throw new Error("auth token required");
  const res = await pythonApi.post<{ status?: string; is_match?: boolean }>(
    "/likes",
    { target_user_id: trimmed },
    { headers: { Authorization: `Bearer ${auth}` } }
  );
  return {
    status: res.data?.status === "ok" ? "ok" : "ok",
    isMatch: Boolean(res.data?.is_match),
  };
}

export async function deleteDatingLike(
  targetUserId: string,
  token: string
): Promise<LikeRemovalResponse> {
  const trimmed = targetUserId?.trim();
  if (!trimmed) throw new Error("target_user_id is required");
  const auth = token?.trim();
  if (!auth) throw new Error("auth token required");
  const res = await pythonApi.delete<{ status?: string; removed?: boolean }>(
    `/likes/${encodeURIComponent(trimmed)}`,
    {
      headers: { Authorization: `Bearer ${auth}` },
    }
  );
  return {
    status: res.data?.status === "ok" ? "ok" : "ok",
    removed: Boolean(res.data?.removed),
  };
}

// Ensure save includes location transparently
export async function saveDatingProfile(
  profile: DatingProfileUpsert
): Promise<DatingProfile> {
  const res = await pythonApi.put<DatingProfile>("/dating/profile", profile);
  return res.data;
}

export async function deleteDatingProfile(
  username: string
): Promise<{ success: true }> {
  const res = await pythonApi.delete<{ success: true }>(
    `/dating/profile/${encodeURIComponent(username)}`
  );
  return res.data;
}

// Delete a single photo from user's dating profile; returns updated profile
export async function removeDatingPhoto(
  username: string,
  url: string
): Promise<DatingProfile> {
  const res = await pythonApi.delete<DatingProfile>(
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
  const res = await pythonApi.post<{ url: string }>(
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
  const res = await pythonApi.post<{ url: string; type: string }>(
    `/uploads/chat-media?username=${encodeURIComponent(username)}`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return res.data;
};

// New: fetch voice recordings by username (optionally group-scoped)
export async function fetchRecordingsByUser(
  username: string,
  limit: number = 50,
  groupId?: string
): Promise<
  Array<{
    messageId?: string;
    groupId?: string;
    timestamp?: string;
    audio?: any;
    createdAt?: number;
  }>
> {
  const params: any = { limit };
  if (groupId) params.groupId = groupId;
  const res = await pythonApi.get<{ items: any[] }>(
    `/users/${encodeURIComponent(username)}/recordings`,
    { params }
  );
  return Array.isArray(res.data?.items) ? res.data.items : [];
}

// Upload a group/avatar image -> returns { url }
export const uploadGroupAvatar = async (
  file: File
): Promise<{ url: string; type?: string }> => {
  const form = new FormData();
  form.append("avatar", file);
  const res = await pythonApi.post<{ url: string; type?: string }>(
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
  const res = await pythonApi.get(`/cloudinary/status`);
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
  const res = await pythonApi.get<LinkedAccount[]>(
    `/users/id/${encodeURIComponent(userId)}/social-links${qs}`
  );
  return res.data || [];
}

export async function saveSocialLinksById(
  userId: string,
  links: LinkedAccount[]
): Promise<LinkedAccount[]> {
  const res = await pythonApi.put<LinkedAccount[]>(
    `/users/id/${encodeURIComponent(userId)}/social-links`,
    links
  );
  return res.data || [];
}

export async function migrateSocialLinks(
  from: string,
  to: string
): Promise<void> {
  await pythonApi.post(`/users/migrate-social-links`, { from, to });
}

// For viewing other users by username (legacy route)
export async function fetchSocialLinksForUsername(
  username: string
): Promise<LinkedAccount[]> {
  const res = await pythonApi.get<LinkedAccount[]>(
    `/users/${encodeURIComponent(username)}/social-links`
  );
  return res.data || [];
}

// --- User Bio (by userId) ---
export async function fetchUserBioById(userId: string): Promise<string> {
  const res = await pythonApi.get<{ bio: string }>(
    `/users/id/${encodeURIComponent(userId)}/bio`
  );
  return res.data?.bio || "";
}

export async function saveUserBioById(
  userId: string,
  bio: string
): Promise<string> {
  const res = await pythonApi.put<{ bio: string }>(
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
