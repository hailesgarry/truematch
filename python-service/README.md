# Python API Service (FastAPI)

This service exposes REST APIs for groups, messages, direct messages (DMs), dating profiles, bios, social links, etc., backed by MongoDB. It runs alongside the Node.js WebSocket server.

## Setup

1. Create a virtual environment (optional but recommended).
2. Install dependencies:

```
pip install -r requirements.txt
```

3. Configure environment variables:

- MONGO_URI=<your MongoDB connection string>
- MONGO_DB_NAME=truematch (default)
- CORS_ORIGIN=http://localhost:5173 (frontend)
- PY_BACKEND_PORT=8081 (optional)

Optional (Kafka acceleration):

- KAFKA_ENABLED=true
- KAFKA_BOOTSTRAP=localhost:9092
- KAFKA_CLIENT_ID=truematch-python
- KAFKA_TOPIC_PREFIX=tm
- KAFKA_GROUP_ID=tm-readmodels

4. Run the dev server:

```
uvicorn app.main:app --reload --port %PY_BACKEND_PORT%
```

On PowerShell, ensure `%PY_BACKEND_PORT%` is defined or replace it with a number.

## Notes

- File uploads (avatars/chat media) are handled here via Cloudinary. Configure CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET in .env.
- MongoDB indices can be added as needed.
- When Kafka is enabled, the service publishes lightweight events on message writes and runs a background consumer to maintain a materialized "latest messages" read model per group. The `GET /api/messages/{groupId}/latest` endpoint consults this read model first, which significantly speeds up first-load latency and reduces query cost. If Kafka is disabled or unavailable, the API continues to function using direct indexed queries and local TTL caches.

### Quick Kafka dev setup (Windows-friendly)

Use Docker Desktop and the following minimal compose to run Kafka locally:

```yaml
version: '3.8'
services:
	zookeeper:
		image: confluentinc/cp-zookeeper:7.5.0
		environment:
			ZOOKEEPER_CLIENT_PORT: 2181
			ZOOKEEPER_TICK_TIME: 2000
		ports: ["2181:2181"]
	kafka:
		image: confluentinc/cp-kafka:7.5.0
		depends_on: [zookeeper]
		ports: ["9092:9092"]
		environment:
			KAFKA_BROKER_ID: 1
			KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
			KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092
			KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
			KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
```

Start it and set `KAFKA_ENABLED=true` and `KAFKA_BOOTSTRAP=localhost:9092` in `.env`.

- The Node service should disable HTTP API routes once Python is fully handling APIs.

## APIs

Base URL: http://localhost:8081/api (configurable via PY_BACKEND_PORT)

### Groups

- GET /groups — list all groups
- GET /groups/{groupId} — fetch a single group
- POST /groups — create or upsert a group
- PUT /groups/{groupId} — update group
- DELETE /groups/{groupId} — delete group and related message metadata

### Messages (Group or Room messages)

- GET /messages/{groupId}/latest?count=100
  Returns the latest N messages for the room (group or DM-style room id). Each item contains:
  - messageId, timestamp, createdAt
  - username, userId, avatar, bubbleColor
  - text, kind, media (optional: { original, preview, gif, thumbnail, type })
  - replyTo (optional): { messageId, username, text, timestamp, kind?, media? }
  - edited, lastEditedAt, edits[]
  - deleted, deletedAt
  - reactions: { [userId]: { emoji, at, userId, username } }

Performance notes:

- On cache miss, the API first checks a materialized `read_messages_latest` document containing the latest window for the group. This keeps first loads fast without hitting large message collections.
- Kafka events update this read model in near real-time on each write. If Kafka is down, the API transparently falls back to indexed queries.

- POST /messages/{groupId}
  Body example:

  {
  "userId": "123",
  "username": "Alice",
  "avatar": "https://.../alice.png",
  "bubbleColor": "#aabbcc",
  "text": "Hello world",
  "kind": "text",  
   "media": { "original": "https://...", "preview": "https://..." },
  "replyTo": { "messageId": "<id>", "username": "Bob", "text": "...", "timestamp": "..." }
  }

  Response: the saved message with IDs and timestamps.

- PUT /messages/{groupId}/{messageId}
  Body: { "newText": "Updated" }
  Response: { success: true, lastEditedAt, edited: true }

- DELETE /messages/{groupId}/{messageId}
  Response: { success: true, deletedAt }

- POST /messages/{groupId}/{messageId}/reactions
  Body: { "emoji": ":smile:", "user": { "userId": "u1", "username": "Alice" } }
  Response: { success: true, messageId, reactions, summary }

- GET /messages/{groupId}/by-id/{messageId}
- GET /messages/{groupId}/by-ts/{timestamp}

### Direct Messages (DMs)

- GET /dm/{dmId}/latest?count=100
  Returns latest N messages in a DM thread. dmId format: dm:alice|bob (lowercase, sorted).

- POST /dm/{dmId}/message
  Body: same shape as group messages (userId, username, text, kind, media, replyTo)

- PUT /dm/{dmId}/{messageId}
  Body: { newText }

- DELETE /dm/{dmId}/{messageId}

- POST /dm/{dmId}/{messageId}/reactions
  Body: { emoji, user: { userId, username } }

- GET /dm/threads?user=<usernameLc>
  Returns { threads: [{ dmId, latest }] } for DMs the user participates in.
