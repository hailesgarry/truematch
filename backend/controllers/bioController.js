const storage = require("../models/storage");
let biosCache = {};

// lazy-load cache
async function ensureLoaded() {
  if (!ensureLoaded._loading) {
    ensureLoaded._loading = storage
      .getBios()
      .then((data) => {
        biosCache = data || {};
      })
      .catch(() => {})
      .finally(() => {
        ensureLoaded._loading = null;
      });
  }
  if (ensureLoaded._loading) await ensureLoaded._loading;
}

class BioController {
  getBioById(userId) {
    const id = String(userId || "").trim();
    if (!id) return "";
    // best-effort sync read from cache; background refresh
    (async () => {
      await ensureLoaded();
    })();
    const v = biosCache[id];
    return typeof v === "string" ? v : "";
  }

  setBioById(userId, bio) {
    const id = String(userId || "").trim();
    if (!id) throw new Error("userId required");
    const text = String(bio || "").slice(0, 2000); // safety cap
    // update cache immediately for sync behavior
    biosCache[id] = text;
    // persist async
    (async () => {
      await ensureLoaded();
      await storage.setBios(biosCache);
    })();
    return biosCache[id];
  }
}

module.exports = new BioController();
