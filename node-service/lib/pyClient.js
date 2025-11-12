const axios = require("axios");

// =============================
// Python API clients
// =============================
const BASE = process.env.PY_API_URL || "http://localhost:8081/api";

// Read-heavy / presence-safe operations keep shorter timeout
const readClient = axios.create({ baseURL: BASE, timeout: 6000 });
// Write / message operations configurable timeout (default 12s)
const writeClient = axios.create({
  baseURL: BASE,
  timeout: Number(process.env.PY_API_WRITE_TIMEOUT_MS || 12000),
});

// Shared lightweight GET timeout retry interceptor (idempotent)
function attachGetRetry(instance) {
  instance.interceptors.response.use(
    (res) => res,
    async (error) => {
      const cfg = error?.config || {};
      const method = (cfg.method || "").toString().toLowerCase();
      const isTimeout =
        error?.code === "ECONNABORTED" ||
        /timeout/i.test(String(error?.message || ""));
      const count = cfg.__retryCount || 0;
      if (method === "get" && isTimeout && count < 2) {
        cfg.__retryCount = count + 1;
        // Exponential backoff + jitter
        const backoff =
          250 * Math.pow(2, count) + Math.floor(Math.random() * 100);
        await new Promise((r) => setTimeout(r, backoff));
        return instance(cfg);
      }
      return Promise.reject(error);
    }
  );
}

attachGetRetry(readClient);
attachGetRetry(writeClient);

// =============================
// Circuit breaker for write operations
// =============================
const CB_THRESHOLD = Number(process.env.PY_API_CB_THRESHOLD || 3);
const CB_COOLDOWN_MS = Number(process.env.PY_API_CB_COOLDOWN_MS || 15000);
let cbFailures = 0;
let cbOpenedAt = 0;
const { recordMessageWrite } = require("./metrics");

function circuitOpen() {
  if (cbFailures >= CB_THRESHOLD) {
    const now = Date.now();
    if (cbOpenedAt === 0) cbOpenedAt = now;
    if (now - cbOpenedAt < CB_COOLDOWN_MS) return true;
    // Cooldown elapsed: reset
    cbFailures = 0;
    cbOpenedAt = 0;
    return false;
  }
  return false;
}

async function guardedWrite(fn, fallback) {
  if (circuitOpen()) {
    recordMessageWrite(0, false, true);
    return fallback;
  }
  const start = Date.now();
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await fn();
      // success resets counter
      cbFailures = 0;
      cbOpenedAt = 0;
      recordMessageWrite(Date.now() - start, true, false);
      return data;
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      const code = e?.code;
      const isNetwork = !e?.response; // DNS, refused, etc.
      const isTimeout =
        code === "ECONNABORTED" || /timeout/i.test(String(e?.message || ""));
      const isServer = typeof status === "number" && status >= 500;
      const retriable = isNetwork || isTimeout || isServer;
      if (!retriable) break; // don't retry 4xx/client errors
      // small backoff with jitter
      await new Promise((r) =>
        setTimeout(r, 200 + Math.floor(Math.random() * 200))
      );
    }
  }
  // Final handling after retries
  const e = lastErr || new Error("unknown write error");
  const status = e?.response?.status;
  const code = e?.code;
  const isNetwork = !e?.response;
  const isTimeout =
    code === "ECONNABORTED" || /timeout/i.test(String(e?.message || ""));
  const isServer = typeof status === "number" && status >= 500;
  const shouldCount = isNetwork || isTimeout || isServer;

  if (shouldCount) cbFailures += 1;

  const opened = circuitOpen();
  recordMessageWrite(0, false, opened);

  if (opened) {
    const why = isNetwork
      ? `network (${code || "no-response"})`
      : isTimeout
      ? "timeout"
      : isServer
      ? `server ${status}`
      : `client ${status}`;
    console.warn(
      `[pyClient] Circuit open after failures; using fallback for writes (last error: ${why})`
    );
  } else if (
    !shouldCount &&
    typeof status === "number" &&
    status >= 400 &&
    status < 500
  ) {
    console.warn(
      `[pyClient] write rejected with client error ${status}; not counting toward circuit`
    );
  }

  return fallback;
}

// (Removed legacy single client interceptor block)

async function getSafe(url, { params, timeout } = {}, fallback) {
  try {
    const { data } = await readClient.get(url, {
      params,
      ...(timeout ? { timeout } : {}),
    });
    return data;
  } catch (e) {
    return fallback;
  }
}

module.exports = {
  // Groups
  async getGroup(groupId) {
    return getSafe(`/groups/${encodeURIComponent(groupId)}`, {}, null);
  },

  // DMs
  async dmHistory(dmId, count) {
    const data = await getSafe(
      `/dm/${encodeURIComponent(dmId)}/latest`,
      { params: { count } },
      []
    );
    return Array.isArray(data) ? data : [];
  },
  async dmSend(dmId, payload) {
    return guardedWrite(async () => {
      const { data } = await writeClient.post(
        `/dm/${encodeURIComponent(dmId)}/message`,
        payload
      );
      return data;
    }, null);
  },
  async dmEdit(dmId, messageId, newText) {
    return guardedWrite(
      async () => {
        const { data } = await writeClient.put(
          `/dm/${encodeURIComponent(dmId)}/${encodeURIComponent(messageId)}`,
          { newText }
        );
        return data;
      },
      { success: false }
    );
  },
  async dmDelete(dmId, messageId) {
    return guardedWrite(
      async () => {
        const { data } = await writeClient.delete(
          `/dm/${encodeURIComponent(dmId)}/${encodeURIComponent(messageId)}`
        );
        return data;
      },
      { success: false }
    );
  },
  async dmReact(dmId, messageId, emoji, user) {
    return guardedWrite(
      async () => {
        const { data } = await writeClient.post(
          `/dm/${encodeURIComponent(dmId)}/${encodeURIComponent(
            messageId
          )}/reactions`,
          {
            emoji,
            user,
          }
        );
        return data;
      },
      { success: false }
    );
  },
  async dmThreads(userLc) {
    const data = await getSafe(
      `/dm/threads`,
      { params: { user: userLc } },
      { threads: [] }
    );
    const threads = data?.threads || data || [];
    return Array.isArray(threads) ? threads : [];
  },

  // Messages (groups)
  async latest(groupId, count) {
    const data = await getSafe(
      `/messages/${encodeURIComponent(groupId)}/latest`,
      { params: { count } },
      []
    );
    return Array.isArray(data) ? data : [];
  },
  async page(groupId, before, limit) {
    const params = {};
    if (before != null) params.before = before;
    if (limit != null) params.limit = limit;
    const data = await getSafe(
      `/messages/${encodeURIComponent(groupId)}/page`,
      { params },
      { items: [], nextBefore: null }
    );
    return data && typeof data === "object"
      ? data
      : { items: [], nextBefore: null };
  },
  async send(groupId, payload) {
    return guardedWrite(async () => {
      const { data } = await writeClient.post(
        `/messages/${encodeURIComponent(groupId)}`,
        payload
      );
      return data;
    }, null);
  },
  async edit(groupId, messageId, newText) {
    return guardedWrite(
      async () => {
        const { data } = await writeClient.put(
          `/messages/${encodeURIComponent(groupId)}/${encodeURIComponent(
            messageId
          )}`,
          { newText }
        );
        return data;
      },
      { success: false }
    );
  },
  async remove(groupId, messageId) {
    return guardedWrite(
      async () => {
        const { data } = await writeClient.delete(
          `/messages/${encodeURIComponent(groupId)}/${encodeURIComponent(
            messageId
          )}`
        );
        return data;
      },
      { success: false }
    );
  },
  async react(groupId, messageId, emoji, user) {
    return guardedWrite(
      async () => {
        const { data } = await writeClient.post(
          `/messages/${encodeURIComponent(groupId)}/${encodeURIComponent(
            messageId
          )}/reactions`,
          { emoji, user }
        );
        return data;
      },
      { success: false }
    );
  },
  async getById(groupId, messageId) {
    return getSafe(
      `/messages/${encodeURIComponent(groupId)}/by-id/${encodeURIComponent(
        messageId
      )}`,
      {},
      null
    );
  },
  async getByTimestamp(groupId, ts) {
    return getSafe(
      `/messages/${encodeURIComponent(groupId)}/by-ts/${encodeURIComponent(
        ts
      )}`,
      {},
      null
    );
  },

  async updateUserBubbleColor(groupId, username, color) {
    return guardedWrite(
      async () => {
        const { data } = await writeClient.post(
          `/messages/${encodeURIComponent(groupId)}/user-bubble-color`,
          { username, color }
        );
        return data;
      },
      { success: false }
    );
  },

  // Group membership (explicit roster)
  async addGroupMember(groupId, body = {}) {
    const username = body?.username;
    if (!groupId || !username) return { success: false };
    const payload = {
      username,
      role: body?.role || "member",
      ...(body?.joinedAt ? { joinedAt: body.joinedAt } : {}),
    };
    return guardedWrite(
      async () => {
        const { data } = await writeClient.post(
          `/groups/${encodeURIComponent(groupId)}/members`,
          payload
        );
        return data;
      },
      { success: false }
    );
  },
  async removeGroupMember(groupId, username) {
    if (!groupId || !username) return { success: false };
    return guardedWrite(
      async () => {
        const { data } = await writeClient.delete(
          `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(
            username
          )}`
        );
        return data;
      },
      { success: false }
    );
  },

  // Message filters
  async messageFilters(userId) {
    if (!userId) return { userId: "", items: [], groups: {} };
    const fallback = { userId, items: [], groups: {} };
    const data = await getSafe(
      `/users/${encodeURIComponent(userId)}/message-filters`,
      {},
      fallback
    );
    if (!data || typeof data !== "object") return fallback;
    const items = Array.isArray(data.items) ? data.items : [];
    const groups =
      data.groups && typeof data.groups === "object" ? data.groups : {};
    const resolvedUser = typeof data.userId === "string" ? data.userId : userId;
    return { userId: resolvedUser, items, groups };
  },
  async addMessageFilter(userId, groupId, username) {
    if (!userId || !groupId || !username) return null;
    try {
      const { data } = await writeClient.post(
        `/users/${encodeURIComponent(userId)}/message-filters`,
        { groupId, username }
      );
      return data;
    } catch (e) {
      return null;
    }
  },
  async removeMessageFilter(userId, groupId, username) {
    if (!userId || !groupId || !username) return null;
    try {
      const { data } = await writeClient.delete(
        `/users/${encodeURIComponent(userId)}/message-filters`,
        {
          data: { groupId, username },
        }
      );
      return data;
    } catch (e) {
      return null;
    }
  },

  // Dating
  async getProfile(username) {
    const data = await getSafe(
      `/dating/profiles/batch`,
      { params: { users: username } },
      []
    );
    return Array.isArray(data) ? data[0] || null : null;
  },
};
