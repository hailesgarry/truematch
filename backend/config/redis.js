const { createClient } = require("redis");

// Single shared Redis client for the app
let client;
let connectingPromise;

function getRedisUrl() {
  // Prefer REDIS_URL when provided (e.g., redis://default:<password>@host:port)
  if (process.env.REDIS_URL) return process.env.REDIS_URL;

  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = process.env.REDIS_PORT || "6379";
  const username =
    process.env.REDIS_USERNAME || process.env.REDIS_USER || "default";
  const password = process.env.REDIS_PASSWORD || process.env.REDIS_PASS || "";

  // Build a redis:// URL (username optional but common on Redis Cloud)
  if (password) {
    return `redis://${encodeURIComponent(username)}:${encodeURIComponent(
      password
    )}@${host}:${port}`;
  }
  return `redis://${host}:${port}`;
}

async function connect() {
  if (client && client.isOpen) return client;
  if (connectingPromise) return connectingPromise;

  const url = getRedisUrl();
  const u = new URL(url);
  const host = u.hostname;
  const port = Number(u.port || (u.protocol === "rediss:" ? 6380 : 6379));
  const username = decodeURIComponent(
    u.username || process.env.REDIS_USERNAME || "default"
  );
  const password = decodeURIComponent(
    u.password || process.env.REDIS_PASSWORD || ""
  );
  const envTls = (process.env.REDIS_TLS || "").toLowerCase();
  const preferTls =
    envTls === "true" ||
    (envTls !== "false" &&
      (u.protocol === "rediss:" || /redis-cloud\.com/i.test(host)));

  const base = {
    socket: {
      host,
      port,
      reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
    },
  };
  if (username) base.username = username;
  if (password) base.password = password;

  async function tryConnect(opts) {
    const c = createClient(opts);
    c.on("error", (err) => {
      console.error("Redis Client Error:", err);
    });
    try {
      await c.connect();
    } catch (e) {
      try {
        await c.quit();
      } catch {}
      try {
        await c.disconnect();
      } catch {}
      throw e;
    }
    return c;
  }

  async function establish() {
    // First attempt
    const firstOpts = preferTls
      ? {
          ...base,
          socket: {
            ...base.socket,
            tls: { servername: host, minVersion: "TLSv1.2" },
          },
        }
      : { ...base };
    try {
      const c = await tryConnect(firstOpts);
      return c;
    } catch (err) {
      // If TLS handshake fails with wrong version, fallback to non-TLS
      const code = err && (err.code || err.reason || "").toString();
      const msg = (err && err.message) || "";
      const looksTlsIssue = /WRONG_VERSION_NUMBER|EPROTO|handshake/i.test(
        code + " " + msg
      );
      if (preferTls && looksTlsIssue) {
        try {
          const c2 = await tryConnect({ ...base });
          return c2;
        } catch (err2) {
          throw err2;
        }
      }
      throw err;
    }
  }

  connectingPromise = establish()
    .then((c) => {
      client = c;
      console.log("Connected to Redis:", `${host}:${port}`);
      return client;
    })
    .finally(() => {
      connectingPromise = null;
    });

  return connectingPromise;
}

function getClient() {
  if (!client)
    throw new Error("Redis client not initialized. Call connect() first.");
  return client;
}

async function disconnect() {
  if (client && client.isOpen) {
    await client.quit();
  }
}

module.exports = { connect, getClient, disconnect };
