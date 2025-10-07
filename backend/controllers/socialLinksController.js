const storage = require("../models/storage");
let linksDb = {};

async function ensureLoaded() {
  if (!ensureLoaded._loading) {
    ensureLoaded._loading = storage
      .getSocialLinks()
      .then((data) => {
        linksDb = data || {};
      })
      .catch(() => {})
      .finally(() => (ensureLoaded._loading = null));
  }
  if (ensureLoaded._loading) await ensureLoaded._loading;
}

class SocialLinksController {
  getLinks(username) {
    const u = String(username || "")
      .trim()
      .toLowerCase();
    if (!u) return [];
    (async () => await ensureLoaded())();
    return Array.isArray(linksDb[u]) ? linksDb[u] : [];
  }

  setLinks(username, links) {
    const u = String(username || "")
      .trim()
      .toLowerCase();
    if (!u) throw new Error("username required");
    if (!Array.isArray(links)) throw new Error("links must be an array");
    linksDb[u] = links;
    (async () => {
      await ensureLoaded();
      await storage.setSocialLinks(linksDb);
    })();
    return linksDb[u];
  }

  // New: userId-based APIs with optional legacy username fallback
  getLinksById(userId, legacyUsername) {
    const id = String(userId || "").trim();
    if (!id) return [];
    (async () => await ensureLoaded())();
    if (Array.isArray(linksDb[id])) return linksDb[id];
    // Fallback: if a legacy username entry exists, migrate it to id key
    const uname = String(legacyUsername || "")
      .trim()
      .toLowerCase();
    if (uname && Array.isArray(linksDb[uname])) {
      const links = linksDb[uname];
      linksDb[id] = links;
      delete linksDb[uname];
      (async () => {
        await ensureLoaded();
        await storage.setSocialLinks(linksDb);
      })();
      return links;
    }
    return [];
  }

  setLinksById(userId, links) {
    const id = String(userId || "").trim();
    if (!id) throw new Error("userId required");
    if (!Array.isArray(links)) throw new Error("links must be an array");
    linksDb[id] = links;
    (async () => {
      await ensureLoaded();
      await storage.setSocialLinks(linksDb);
    })();
    return linksDb[id];
  }

  migrate(fromUsername, toUsername) {
    const from = String(fromUsername || "")
      .trim()
      .toLowerCase();
    const to = String(toUsername || "")
      .trim()
      .toLowerCase();
    if (!from || !to) throw new Error("from/to required");
    if (from === to) return this.getLinks(to);
    (async () => await ensureLoaded())();
    const links = Array.isArray(linksDb[from]) ? linksDb[from] : [];
    linksDb[to] = links;
    delete linksDb[from];
    (async () => {
      await ensureLoaded();
      await storage.setSocialLinks(linksDb);
    })();
    return linksDb[to];
  }
}

module.exports = new SocialLinksController();
