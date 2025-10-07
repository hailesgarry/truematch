const datingModel = require("../models/dating");

class DatingController {
  getAllProfiles() {
    return datingModel.getAll();
  }
  getProfile(username) {
    return datingModel.getByUsername(username);
  }
  getProfilesByUsernames(usernames = []) {
    const set = new Set(
      (Array.isArray(usernames) ? usernames : [])
        .map((u) => String(u || "").toLowerCase())
        .filter(Boolean)
    );
    const all = datingModel.getAll();
    return all.filter((p) => set.has(String(p.username || "").toLowerCase()));
  }
  upsertProfile(profile) {
    return datingModel.upsert(profile);
  }
  removePhoto(username, url) {
    return datingModel.removePhoto(username, url);
  }
  deleteProfile(username) {
    return datingModel.deleteUserCompletely(username);
  }

  // Added: basic filter by the given user's preferences
  filterByPreferencesForUser(username) {
    const user = datingModel.getByUsername(username);
    const all = datingModel.getAll();
    if (!user || !user.preferences) return all;
    const pref = user.preferences;
    return all.filter((p) => {
      if (!p || !p.username) return false;
      if (String(p.username).toLowerCase() === String(username).toLowerCase())
        return false;
      if (pref.gender && p.gender && pref.gender !== p.gender) return false;
      if (pref.minAge && typeof p.age === "number" && p.age < pref.minAge)
        return false;
      if (pref.maxAge && typeof p.age === "number" && p.age > pref.maxAge)
        return false;
      return true;
    });
  }
}

module.exports = new DatingController();
