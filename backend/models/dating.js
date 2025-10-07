const storage = require("./storage");

class DatingModel {
  constructor() {
    this.cache = [];
    this.likes = [];
  }

  init() {
    (async () => {
      try {
        this.cache = await storage.getProfiles();
        this.likes = await storage.getLikes();
      } catch (e) {
        console.error("Failed to load dating data from Redis:", e);
        this.cache = [];
        this.likes = [];
      }
    })();
  }

  getAll() {
    return [...this.cache].sort(
      (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
    );
  }

  getByUsername(username) {
    return (
      this.cache.find(
        (p) =>
          (p.username || "").toLowerCase() === String(username).toLowerCase()
      ) || null
    );
  }

  upsert(profile) {
    const username = String(profile.username || "").trim();
    if (!username) throw new Error("username required");
    const now = Date.now();
    const idx = this.cache.findIndex(
      (p) => (p.username || "").toLowerCase() === username.toLowerCase()
    );

    const existing = idx >= 0 ? this.cache[idx] : {};

    // Sanitize photos array
    const nextPhotos = Array.isArray(profile.photos)
      ? profile.photos.filter(
          (u) => typeof u === "string" && u.trim().length > 0
        )
      : existing.photos ?? [];

    // Compute primary URL
    const computedPrimary =
      profile.photoUrl !== undefined
        ? profile.photoUrl
        : nextPhotos && nextPhotos.length
        ? nextPhotos[0]
        : existing.photoUrl ?? null;

    // Basic validation
    const normalizedAge =
      typeof profile.age === "number" ? Math.round(profile.age) : existing.age;
    if (
      typeof normalizedAge === "number" &&
      (normalizedAge < 18 || normalizedAge > 120)
    ) {
      throw new Error("age must be between 18 and 120");
    }

    const next = {
      username,

      // Basic fields
      mood: profile.mood ?? existing.mood ?? "",

      // Photos
      photoUrl: computedPrimary, // legacy primary
      photo:
        profile.photo !== undefined ? profile.photo : existing.photo ?? null, // legacy base64
      photos: nextPhotos, // multiple

      // Demographics/preferences
      age:
        profile.age !== undefined ? normalizedAge : existing.age ?? undefined,
      religion:
        profile.religion !== undefined
          ? profile.religion
          : existing.religion ?? undefined,
      gender:
        profile.gender !== undefined
          ? profile.gender
          : existing.gender ?? undefined,
      preferences:
        profile.preferences !== undefined
          ? profile.preferences
          : existing.preferences ?? undefined,

      // Location
      location:
        profile.location !== undefined
          ? profile.location
          : existing.location ?? null,

      updatedAt: now,
    };

    if (idx >= 0) this.cache[idx] = next;
    else this.cache.push(next);

    storage.setProfiles(this.cache);
    return next;
  }

  // Remove a specific photo URL from a user's profile; returns updated profile or null
  removePhoto(username, url) {
    const uname = String(username || "").trim();
    const targetUrl = String(url || "").trim();
    if (!uname || !targetUrl) return null;
    const idx = this.cache.findIndex(
      (p) => (p.username || "").toLowerCase() === uname.toLowerCase()
    );
    if (idx < 0) return null;
    const existing = this.cache[idx] || {};
    const photos = Array.isArray(existing.photos) ? existing.photos : [];
    const nextPhotos = photos.filter((u) => String(u) !== targetUrl);
    if (nextPhotos.length === photos.length) {
      // nothing changed
      return existing;
    }
    const next = {
      ...existing,
      photos: nextPhotos,
      photoUrl: nextPhotos.length ? nextPhotos[0] : null,
      updatedAt: Date.now(),
    };
    this.cache[idx] = next;
    storage.setProfiles(this.cache);
    return next;
  }

  deleteByUsername(username) {
    const before = this.cache.length;
    this.cache = this.cache.filter(
      (p) => (p.username || "").toLowerCase() !== String(username).toLowerCase()
    );
    if (this.cache.length !== before) storage.setProfiles(this.cache);
    return before !== this.cache.length;
  }

  // Remove a user's profile and purge any likes where they are sender or receiver
  deleteUserCompletely(username) {
    const uname = String(username || "")
      .trim()
      .toLowerCase();
    if (!uname) return false;
    const removed = this.deleteByUsername(uname);
    // Purge likes that reference this user
    const beforeLikes = this.likes.length;
    this.likes = this.likes.filter(
      (e) => e.fromLc !== uname && e.toLc !== uname
    );
    if (this.likes.length !== beforeLikes) storage.setLikes(this.likes);
    return removed;
  }

  // ========== NEW: Likes persistence API ==========

  // Idempotent like; returns { fromLc, toLc, at }
  addLike(fromUsername, toUsername, atTs) {
    const fromLc = String(fromUsername || "")
      .trim()
      .toLowerCase();
    const toLc = String(toUsername || "")
      .trim()
      .toLowerCase();
    if (!fromLc || !toLc || fromLc === toLc) return null;

    // If exists, keep earliest at or update to current?
    const existingIdx = this.likes.findIndex(
      (e) => e.fromLc === fromLc && e.toLc === toLc
    );
    const at = Number.isFinite(atTs) ? Number(atTs) : Date.now();

    if (existingIdx >= 0) {
      // Update timestamp to latest (optional); simplest: set to now
      this.likes[existingIdx].at = at;
    } else {
      this.likes.push({ fromLc, toLc, at });
    }
    storage.setLikes(this.likes);
    return { fromLc, toLc, at };
  }

  // Idempotent unlike; returns true if removed
  removeLike(fromUsername, toUsername) {
    const fromLc = String(fromUsername || "")
      .trim()
      .toLowerCase();
    const toLc = String(toUsername || "")
      .trim()
      .toLowerCase();
    const before = this.likes.length;
    this.likes = this.likes.filter(
      (e) => !(e.fromLc === fromLc && e.toLc === toLc)
    );
    if (this.likes.length !== before) {
      storage.setLikes(this.likes);
      return true;
    }
    return false;
  }

  // All users who liked "toUsername"
  getIncomingLikesFor(toUsername) {
    const toLc = String(toUsername || "")
      .trim()
      .toLowerCase();
    return this.likes
      .filter((e) => e.toLc === toLc)
      .map((e) => ({ from: e.fromLc, at: e.at }))
      .sort((a, b) => b.at - a.at);
  }

  // All users that "fromUsername" liked
  getOutgoingLikesFor(fromUsername) {
    const fromLc = String(fromUsername || "")
      .trim()
      .toLowerCase();
    return this.likes
      .filter((e) => e.fromLc === fromLc)
      .map((e) => ({ to: e.toLc, at: e.at }))
      .sort((a, b) => b.at - a.at);
  }
}

module.exports = new DatingModel();
