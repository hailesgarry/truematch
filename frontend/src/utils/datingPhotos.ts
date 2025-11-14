import type { DatingProfile } from "../types";

const pushCandidate = (seen: Set<string>, output: string[], value: unknown) => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      pushCandidate(seen, output, entry);
    }
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed || seen.has(trimmed)) {
    return;
  }
  seen.add(trimmed);
  output.push(trimmed);
};

export const collectDatingPhotos = (
  profile?: DatingProfile | null
): string[] => {
  if (!profile) {
    return [];
  }
  const seen = new Set<string>();
  const output: string[] = [];
  pushCandidate(
    seen,
    output,
    (profile as any)?.primaryPhotoUrl ?? profile.primaryPhotoUrl ?? null
  );
  pushCandidate(seen, output, profile.photoUrl ?? null);
  pushCandidate(seen, output, (profile as any)?.photo ?? null);
  pushCandidate(seen, output, profile.photos ?? []);
  pushCandidate(seen, output, profile.profileAvatarUrl ?? null);
  return output;
};

export const getPrimaryDatingPhoto = (
  profile?: DatingProfile | null
): string | null => {
  const photos = collectDatingPhotos(profile);
  return photos.length > 0 ? photos[0] : null;
};
