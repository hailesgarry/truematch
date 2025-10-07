// Redis-backed storage abstraction that mimics the previous file-based JSON shapes.
// Keys namespace: app:{domain}:{id}
const { getClient } = require("../config/redis");

const NS = "app"; // namespace prefix

function k(...parts) {
  return [NS, ...parts].join(":");
}

// Helper JSON ops
async function readJson(key, fallback) {
  const client = getClient();
  const raw = await client.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(key, value) {
  const client = getClient();
  const str = JSON.stringify(value);
  await client.set(key, str);
}

// Collections helpers (stored as JSON arrays or objects)
const storage = {
  // Groups: object map groupId -> group
  async getGroups() {
    return (await readJson(k("groups"), {})) || {};
  },
  async setGroups(groupsObj) {
    await writeJson(k("groups"), groupsObj || {});
  },

  // Messages: per-group array
  async getMessages(groupId) {
    return (await readJson(k("messages", groupId), [])) || [];
  },
  async setMessages(groupId, arr) {
    await writeJson(k("messages", groupId), Array.isArray(arr) ? arr : []);
  },
  async deleteMessages(groupId) {
    const client = getClient();
    try {
      await client.del(k("messages", groupId));
      return true;
    } catch {
      return false;
    }
  },
  async deleteGroup(groupId) {
    const client = getClient();
    try {
      // Delete legacy JSON, stream, overlays, reactions, and list keys
      await client.del(
        k("messages", groupId),
        k("xmsg", groupId),
        k("xmsgmeta", groupId),
        k("xmsgreact", groupId),
        k("listmsg", groupId)
      );
      return true;
    } catch {
      return false;
    }
  },
  async listMessageGroupIds() {
    const client = getClient();
    const prefix = k("messages");
    const iter = client.scanIterator({ MATCH: `${prefix}:*`, COUNT: 100 });
    const out = [];
    for await (const key of iter) {
      // Ensure key is a string (node-redis may yield Buffers depending on config)
      const ks =
        typeof key === "string"
          ? key
          : Buffer.isBuffer(key)
          ? key.toString()
          : String(key);
      if (!ks) continue;
      // Extract the group id after the `${prefix}:` portion to be robust against additional colons in the id
      if (ks.startsWith(prefix + ":")) {
        const id = ks.slice(prefix.length + 1);
        if (id) out.push(id);
      }
    }
    return out;
  },

  // =========================
  // Redis Lists (atomic push+trim)
  // =========================
  // Use an EVAL-based Lua script to atomically RPUSH + LTRIM and return the new length
  async pushGroupMessageWithTrim(groupId, messageObj, max) {
    const client = getClient();
    const key = k("listmsg", groupId);
    const cap = Math.max(1, Number(max || 100));
    const json = JSON.stringify(messageObj || {});
    const script = `
      local key = KEYS[1]
      local cap = tonumber(ARGV[1])
      local val = ARGV[2]
      redis.call('RPUSH', key, val)
      redis.call('LTRIM', key, -cap, -1)
      return redis.call('LLEN', key)
    `;
    // EVAL script with 1 key
    const len = await client.eval(script, {
      keys: [key],
      arguments: [String(cap), json],
    });
    return Number(len) || 0;
  },
  async listFetchLatest(groupId, count) {
    const client = getClient();
    const key = k("listmsg", groupId);
    const n = Math.max(1, Number(count || 100));
    // Fetch last n in correct (oldest->newest) order
    const arr = await client.lRange(key, -n, -1);
    return (arr || [])
      .map((s) => {
        try {
          return JSON.parse(
            typeof s === "string" ? s : s?.toString?.() || "null"
          );
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  },

  // =========================
  // Redis Streams (capped window + range fetch)
  // =========================
  async xaddGroupMessage(groupId, fields, max) {
    // fields: object of flat string values; we store a single 'json' field
    const client = getClient();
    const key = k("xmsg", groupId);
    const cap = Math.max(1, Number(max || 100));
    // Convert to [field, value, field, value, ...]
    const flat = [];
    for (const [f, v] of Object.entries(fields || {})) {
      flat.push(String(f));
      flat.push(v == null ? "" : String(v));
    }
    // XADD key MAXLEN ~ cap * field value ... ; using * for server time
    // node-redis v5: xAdd(key, id, message, options)
    // We'll use command form for portability
    // XADD returns the entry id
    const id = await client.xAdd(
      key,
      "*",
      Object.fromEntries(
        flat.reduce((acc, cur, i, a) => {
          if (i % 2 === 0) acc.push([cur, a[i + 1]]);
          return acc;
        }, [])
      ),
      { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: cap } }
    );
    return id; // e.g., '1700000000000-0'
  },
  async xRangeLatest(groupId, count, { reverse = false } = {}) {
    const client = getClient();
    const key = k("xmsg", groupId);
    const n = Math.max(1, Number(count || 100));
    // Fetch newest N, then normalize ascending order
    const entries = reverse
      ? await client.xRevRange(key, "+", "-", { COUNT: n })
      : await client.xRange(key, "-", "+", { COUNT: n });
    // entries is an array of { id, message: { field: value } }
    const list = (entries || [])
      .map((e) => {
        const raw = e?.message?.json;
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }
        if (parsed && !parsed.streamId) parsed.streamId = e?.id;
        return parsed;
      })
      .filter(Boolean);
    // If we used xRevRange, it's newest->oldest; flip for ascending
    return reverse ? list.reverse() : list;
  },
  async xReadRange(groupId, startId, endId, count) {
    const client = getClient();
    const key = k("xmsg", groupId);
    const entries = await client.xRange(
      key,
      startId || "-",
      endId || "+",
      count ? { COUNT: Number(count) } : undefined
    );
    return (entries || [])
      .map((e) => {
        const raw = e?.message?.json;
        try {
          const m = raw ? JSON.parse(raw) : null;
          if (m && !m.streamId) m.streamId = e?.id;
          return m;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  },

  // Paged fetch: newest-first pages using XREVRANGE, then return in ascending order
  async xPage(groupId, { before, limit } = {}) {
    const client = getClient();
    const key = k("xmsg", groupId);
    const n = Math.max(1, Number(limit || 50));
    const end = before ? `(${before}` : "+"; // exclusive end when cursor provided
    const entries = await client.xRevRange(key, end, "-", { COUNT: n });
    const list = (entries || [])
      .map((e) => {
        const raw = e?.message?.json;
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {}
        if (parsed && !parsed.streamId) parsed.streamId = e?.id;
        return parsed;
      })
      .filter(Boolean);
    // Reverse to ascending order
    const ascending = list.reverse();
    // Next cursor is the oldest id we returned; if less than page size, no more
    const nextBefore = ascending.length ? ascending[0].streamId : null;
    return { items: ascending, nextBefore };
  },

  async xLen(groupId) {
    const client = getClient();
    const key = k("xmsg", groupId);
    try {
      return await client.xLen(key);
    } catch {
      return 0;
    }
  },
  async xHeadTail(groupId) {
    const client = getClient();
    const key = k("xmsg", groupId);
    const headArr = await client.xRange(key, "-", "+", { COUNT: 1 });
    const tailArr = await client.xRevRange(key, "+", "-", { COUNT: 1 });
    const head = headArr?.[0]?.id || null;
    const tail = tailArr?.[0]?.id || null;
    return { head, tail };
  },

  async xGetById(groupId, id) {
    const client = getClient();
    const key = k("xmsg", groupId);
    const entries = await client.xRange(key, id, id);
    if (!entries || !entries.length) return null;
    const e = entries[0];
    const raw = e?.message?.json;
    try {
      const m = raw ? JSON.parse(raw) : null;
      if (m && !m.streamId) m.streamId = e?.id;
      return m;
    } catch {
      return null;
    }
  },

  // =========================
  // DM helpers
  // =========================
  async listDmIdsForUser(userLc) {
    const client = getClient();
    const prefix = k("xmsg", "dm"); // app:xmsg:dm
    const iter = client.scanIterator({ MATCH: `${prefix}:*`, COUNT: 200 });
    const out = [];
    const who = String(userLc || "").toLowerCase();
    for await (const key of iter) {
      const ks =
        typeof key === "string"
          ? key
          : Buffer.isBuffer(key)
          ? key.toString()
          : String(key);
      if (!ks || !ks.startsWith(prefix + ":")) continue;
      const id = ks.slice(prefix.length + 1); // dmId string
      if (!id || !id.startsWith("dm:")) continue;
      // id format: dm:userA|userB
      const parts = id.slice(3).split("|");
      if (parts.length !== 2) continue;
      const a = (parts[0] || "").toLowerCase();
      const b = (parts[1] || "").toLowerCase();
      if (who && (a === who || b === who)) out.push(id);
    }
    return out;
  },

  // Overlays for edit/delete on immutable streams: HSET app:xmsgmeta:<groupId> <streamId> '{...}'
  async xOverlayPut(groupId, streamId, overlayObj) {
    const client = getClient();
    const key = k("xmsgmeta", groupId);
    const json = JSON.stringify(overlayObj || {});
    await client.hSet(key, streamId, json);
    return true;
  },
  // Aliases for simpler usage from models
  async overlaySet(groupId, messageId, overlayObj) {
    return this.xOverlayPut(groupId, messageId, overlayObj);
  },
  async xOverlayGetMany(groupId, streamIds) {
    const client = getClient();
    const key = k("xmsgmeta", groupId);
    const ids = Array.isArray(streamIds) ? streamIds : [];
    if (!ids.length) return {};
    const result = await client.hmGet(key, ids);
    const out = {};
    ids.forEach((id, i) => {
      const raw = Array.isArray(result)
        ? result[i]
        : result && (result[id] ?? null);
      if (!raw) return;
      try {
        out[id] = JSON.parse(
          typeof raw === "string" ? raw : raw?.toString?.() || "{}"
        );
      } catch {
        // ignore parse error
      }
    });
    return out;
  },
  async overlayGetMany(groupId, messageIds) {
    return this.xOverlayGetMany(groupId, messageIds);
  },

  // Reactions per messageId: HSET app:xmsgreact:<groupId> <messageId> '{...reactionsMap...}'
  async reactionsGetMany(groupId, messageIds) {
    const client = getClient();
    const key = k("xmsgreact", groupId);
    const ids = Array.isArray(messageIds) ? messageIds : [];
    if (!ids.length) return {};
    const result = await client.hmGet(key, ids);
    const out = {};
    ids.forEach((id, i) => {
      const raw = Array.isArray(result)
        ? result[i]
        : result && (result[id] ?? null);
      if (!raw) return;
      try {
        out[id] = JSON.parse(
          typeof raw === "string" ? raw : raw?.toString?.() || "{}"
        );
      } catch {
        // ignore parse error
      }
    });
    return out;
  },
  async reactionsSet(groupId, messageId, reactionsObj) {
    const client = getClient();
    const key = k("xmsgreact", groupId);
    if (!reactionsObj || !Object.keys(reactionsObj).length) {
      await client.hDel(key, messageId);
      return true;
    }
    await client.hSet(key, messageId, JSON.stringify(reactionsObj));
    return true;
  },

  // Dating profiles: array
  async getProfiles() {
    return (await readJson(k("dating", "profiles"), [])) || [];
  },
  async setProfiles(arr) {
    await writeJson(k("dating", "profiles"), Array.isArray(arr) ? arr : []);
  },
  // Likes: array of { fromLc, toLc, at }
  async getLikes() {
    return (await readJson(k("dating", "likes"), [])) || [];
  },
  async setLikes(arr) {
    await writeJson(k("dating", "likes"), Array.isArray(arr) ? arr : []);
  },

  // Bios: object userId -> bio string
  async getBios() {
    return (await readJson(k("users", "bios"), {})) || {};
  },
  async setBios(obj) {
    await writeJson(k("users", "bios"), obj || {});
  },

  // Social links: object key (username lower or userId) -> links[]
  async getSocialLinks() {
    return (await readJson(k("users", "socialLinks"), {})) || {};
  },
  async setSocialLinks(obj) {
    await writeJson(k("users", "socialLinks"), obj || {});
  },
};

module.exports = storage;
