require("dotenv").config();
const { createClient } = require("redis");

async function check({ url, tls }) {
  const u = new URL(url);
  const host = u.hostname;
  const port = Number(u.port || (u.protocol === "rediss:" ? 6380 : 6379));
  const username = decodeURIComponent(
    u.username || process.env.REDIS_USERNAME || "default"
  );
  const password = decodeURIComponent(
    u.password || process.env.REDIS_PASSWORD || ""
  );
  const socket = { host, port, reconnectStrategy: () => null };
  if (tls === true) socket.tls = { servername: host, minVersion: "TLSv1.2" };

  const client = createClient({ username, password, socket });
  const label = `host=${host} port=${port} tls=${!!tls}`;
  const start = Date.now();
  try {
    await client.connect();
    console.log("OK connect:", label, `(${Date.now() - start}ms)`);
    const pong = await client.ping();
    console.log("PING:", pong);
  } catch (e) {
    console.error("FAIL connect:", label);
    console.error(String(e?.message || e));
  } finally {
    try {
      await client.quit();
    } catch {}
  }
}

(async () => {
  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  console.log("Testing Redis with URL:", url.replace(/:\\S+@/, ":***@"));
  const envTls = (process.env.REDIS_TLS || "").toLowerCase();
  const preferTls = envTls === "true" || new URL(url).protocol === "rediss:";
  await check({ url, tls: preferTls });
  await check({ url, tls: !preferTls });
})();
