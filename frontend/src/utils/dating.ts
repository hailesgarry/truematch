import type { DatingProfile } from "../types";

const normalizeIdentifier = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed;
};

const normalizeUsernameKey = (value?: string | null): string => {
  const trimmed = normalizeIdentifier(value);
  return trimmed.toLowerCase();
};

const deriveKey = (
  userId?: string | null,
  username?: string | null
): string => {
  const id = normalizeIdentifier(userId);
  if (id) return `id:${id}`;
  const uname = normalizeUsernameKey(username);
  return uname ? `name:${uname}` : "";
};

export const deriveDatingProfileKey = (
  profile?: Pick<DatingProfile, "userId" | "username"> | null
): string => {
  if (!profile) return "";
  return deriveKey(profile.userId, profile.username);
};

/**
 * Filter profiles based on the current user's preferences:
 * - Removes the current user (by userId or username)
 * - Age range filter if provided
 * - Religion filter (case-insensitive) if provided and not Any/empty
 */
export function filterProfilesByPreferences(
  all: DatingProfile[],
  options?: {
    selfProfile?: DatingProfile | null;
    selfUserId?: string | null;
    selfUsername?: string | null;
  }
): DatingProfile[] {
  const selfProfile = options?.selfProfile ?? null;
  const selfUserId = options?.selfUserId ?? selfProfile?.userId ?? null;
  const selfUsername = options?.selfUsername ?? selfProfile?.username ?? null;

  const selfKey = deriveKey(selfUserId, selfUsername);

  const others = all.filter(
    (candidate) => deriveDatingProfileKey(candidate) !== selfKey
  );

  const prefSource =
    selfProfile ||
    (selfKey ? all.find((p) => deriveDatingProfileKey(p) === selfKey) : null);

  if (!prefSource || !prefSource.preferences) return others;

  const agePref = prefSource.preferences.age;
  const religionPrefs = (prefSource.preferences.religions || [])
    .map((r) =>
      String(r || "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);

  const religionFilteringActive =
    religionPrefs.length > 0 && !religionPrefs.includes("any");

  return others.filter((candidate) => {
    if (
      agePref &&
      typeof agePref.min === "number" &&
      typeof agePref.max === "number"
    ) {
      if (typeof candidate.age === "number") {
        if (candidate.age < agePref.min || candidate.age > agePref.max) {
          return false;
        }
      } else {
        return false;
      }
    }

    if (religionFilteringActive) {
      const candidateRel = String(candidate.religion || "")
        .trim()
        .toLowerCase();
      if (!candidateRel || !religionPrefs.includes(candidateRel)) {
        return false;
      }
    }

    return true;
  });
}
