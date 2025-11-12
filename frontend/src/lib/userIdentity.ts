import type { NavigateFunction } from "react-router-dom";
import {
  fetchProfileById,
  fetchProfileByUsername,
  resolveUserIdByUsername,
} from "../services/api";

const usernameById = new Map<string, string>();
const userIdByUsername = new Map<string, string>();

export function cacheUserIdentity(
  userId: string | null | undefined,
  username: string | null | undefined
): void {
  const id = (userId || "").trim();
  const name = (username || "").trim();
  if (!id || !name) return;
  usernameById.set(id, name);
  userIdByUsername.set(name.toLowerCase(), id);
}

export function getCachedUsername(
  userId: string | null | undefined
): string | null {
  const id = (userId || "").trim();
  if (!id) return null;
  return usernameById.get(id) ?? null;
}

export function getCachedUserId(
  username: string | null | undefined
): string | null {
  const name = (username || "").trim().toLowerCase();
  if (!name) return null;
  return userIdByUsername.get(name) ?? null;
}

export async function resolveUserIdentity(options: {
  userId?: string | null;
  username?: string | null;
}): Promise<{ userId: string; username: string } | null> {
  const candidateId = (options.userId || "").trim();
  const candidateUsername = (options.username || "").trim();

  // 1. If we have a candidate userId, try cache then fetch by id
  if (candidateId) {
    const cachedName = getCachedUsername(candidateId);
    if (cachedName) {
      cacheUserIdentity(candidateId, cachedName);
      return { userId: candidateId, username: cachedName };
    }
    const profileById = await fetchProfileById(candidateId);
    if (profileById) {
      cacheUserIdentity(profileById.userId, profileById.username);
      return { userId: profileById.userId, username: profileById.username };
    }
  }

  // 2. Resolve via username when provided
  if (candidateUsername) {
    const cachedId = getCachedUserId(candidateUsername);
    if (cachedId) {
      const cachedName = getCachedUsername(cachedId) ?? candidateUsername;
      cacheUserIdentity(cachedId, cachedName);
      return { userId: cachedId, username: cachedName };
    }
    const profileByUsername = await fetchProfileByUsername(candidateUsername);
    if (profileByUsername) {
      cacheUserIdentity(profileByUsername.userId, profileByUsername.username);
      return {
        userId: profileByUsername.userId,
        username: profileByUsername.username,
      };
    }
    const resolvedId = await resolveUserIdByUsername(candidateUsername);
    if (resolvedId) {
      cacheUserIdentity(resolvedId, candidateUsername);
      return { userId: resolvedId, username: candidateUsername };
    }
  }

  // 3. As a final fallback, treat the candidate ID as a legacy username
  if (candidateId) {
    const profileFromUsername = await fetchProfileByUsername(candidateId);
    if (profileFromUsername) {
      cacheUserIdentity(
        profileFromUsername.userId,
        profileFromUsername.username
      );
      return {
        userId: profileFromUsername.userId,
        username: profileFromUsername.username,
      };
    }
    const resolvedId = await resolveUserIdByUsername(candidateId);
    if (resolvedId) {
      cacheUserIdentity(resolvedId, candidateId);
      return { userId: resolvedId, username: candidateId };
    }
  }

  return null;
}

export async function navigateToUserProfile(
  navigate: NavigateFunction,
  options: {
    userId?: string | null;
    username?: string | null;
    replace?: boolean;
    state?: Record<string, unknown>;
  }
): Promise<{ userId: string; username: string } | null> {
  const identity = await resolveUserIdentity({
    userId: options.userId,
    username: options.username,
  });
  if (!identity) return null;

  const targetPath = `/profile/${encodeURIComponent(identity.userId)}`;
  const navState = {
    ...(options.state || {}),
    userId: identity.userId,
    username: identity.username,
  };
  cacheUserIdentity(identity.userId, identity.username);
  navigate(targetPath, {
    state: navState,
    replace: Boolean(options.replace),
  });
  return identity;
}

export async function navigateToDmThread(
  navigate: NavigateFunction,
  options: {
    userId?: string | null;
    username?: string | null;
    replace?: boolean;
    state?: Record<string, unknown>;
  }
): Promise<{ userId: string; username: string } | null> {
  const identity = await resolveUserIdentity({
    userId: options.userId,
    username: options.username,
  });
  if (!identity) return null;

  const targetPath = `/dm/${encodeURIComponent(identity.userId)}`;
  const navState = {
    ...(options.state || {}),
    userId: identity.userId,
    username: identity.username,
  };
  cacheUserIdentity(identity.userId, identity.username);
  navigate(targetPath, {
    state: navState,
    replace: Boolean(options.replace),
  });
  return identity;
}
