# Redis integration

This backend now uses Redis for all persistent data instead of JSON files.

What moved to Redis:

- Groups map (key: app:groups)
- Group messages (Streams): app:xmsg:{groupId} with MAXLEN ~ N and field 'json'
- Group message overlays (edits/deletes): Hash app:xmsgmeta:{groupId} messageId -> overlay JSON
- Group reactions: Hash app:xmsgreact:{groupId} messageId -> reactions JSON
- Legacy per-id message arrays (DMs only): app:messages:{groupId}
- Optional List utility (not used by default): app:listmsg:{groupId} via atomic RPUSH+LTRIM
- Dating profiles array (key: app:dating:profiles)
- Dating likes array (key: app:dating:likes)
- User bios map (key: app:users:bios)
- Social links map (key: app:users:socialLinks)

Environment variables (create a .env from .env.example):

- REDIS_URL or REDIS_HOST/REDIS_PORT/REDIS_USERNAME/REDIS_PASSWORD
- PORT, CORS_ORIGIN

Windows quickstart (PowerShell):

1. Copy .env.example to .env and fill your Redis Cloud details.
2. Install deps: `npm i`
3. Start dev server: `npm run dev`

Notes:

- Groups now stream new messages; history fetch uses XRANGE/XREVRANGE and overlays are merged server-side. Edits/deletes for messages outside the rolling window respond with not found.
- On first run, if existing JSON files are present, messages are imported once into Redis.
- Group defaults are created if none exist in Redis.
