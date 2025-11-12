import type { DatingProfile } from "../types";

/**
 * Filter profiles based on the current user's preferences:
 * - Removes the current user
 * - Age range filter if provided
 * - Religion filter (case-insensitive) if provided and not Any/empty
 */
export function filterProfilesByPreferences(
  all: DatingProfile[],
  selfUsername?: string | null
): DatingProfile[] {
  const self =
    selfUsername &&
    all.find(
      (p) =>
        (p.username || "").toLowerCase() === String(selfUsername).toLowerCase()
    );

  const others = all.filter(
    (p) =>
      (p.username || "").toLowerCase() !==
      String(selfUsername || "").toLowerCase()
  );

  if (!self || !self.preferences) return others;

  const agePref = self.preferences.age;
  const religionPrefs = (self.preferences.religions || [])
    .map((r) =>
      String(r || "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);

  const religionFilteringActive =
    religionPrefs.length > 0 && !religionPrefs.includes("any");

  return others.filter((p) => {
    // Age filter
    if (agePref && typeof p.age === "number") {
      if (p.age < agePref.min || p.age > agePref.max) return false;
    } else if (agePref) {
      // If pref set but candidate doesn't have age, exclude conservatively
      return false;
    }

    // Religion filter
    if (religionFilteringActive) {
      const candidateRel = String(p.religion || "")
        .trim()
        .toLowerCase();
      if (!candidateRel || !religionPrefs.includes(candidateRel)) return false;
    }

    return true;
  });
}
