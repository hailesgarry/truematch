const path = require("path");
// Ensure .env is loaded from the backend folder regardless of CWD
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const config = require("./config");
const { setupGroupSocketHandlers } = require("./socket/groupSocketHandler");
const { setupDmSocketHandlers } = require("./socket/dmSocketHandler");
const cors = require("cors");
// Models and MongoDB are no longer initialized here; Python service handles data.
// Mount minimal REST routes used by the frontend (presence, health)
const apiRouter = require("./routes/api");

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// CORS (now configurable via env)
const allowedOriginsRaw = Array.isArray(config.corsOrigins)
  ? config.corsOrigins
  : config.corsOrigins
  ? [config.corsOrigins]
  : [];

const allowedOrigins = allowedOriginsRaw
  .map((origin) => String(origin || "").trim())
  .filter((origin) => origin && origin !== "*");

if (allowedOrigins.length === 0) {
  console.warn(
    "[CORS] No explicit origins configured. Cross-origin requests will be rejected."
  );
} else {
  console.log("[CORS] Allowed origins:", allowedOrigins);
}

const allowAllOrigins = allowedOrigins.includes("*");
const normalizedAllowedOrigins = allowAllOrigins
  ? null
  : new Set(allowedOrigins.map((origin) => origin.toLowerCase()));

const fallbackOrigin = allowedOrigins.length > 0 ? allowedOrigins[0] : null;

const resolveCorsOrigin = (requestOrigin, callback) => {
  if (!requestOrigin) {
    if (allowAllOrigins) {
      return callback(null, true);
    }
    if (fallbackOrigin) {
      return callback(null, fallbackOrigin);
    }
    return callback(new Error("Not allowed by CORS"));
  }
  if (allowAllOrigins) {
    return callback(null, requestOrigin || true);
  }
  if (normalizedAllowedOrigins?.has(requestOrigin.toLowerCase())) {
    return callback(null, requestOrigin);
  }
  return callback(new Error("Not allowed by CORS"));
};

const corsOptions = {
  origin: resolveCorsOrigin,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));

// Socket.IO
// Always use a function for Socket.IO CORS to prevent wildcard (*) responses
// which are not allowed when credentials: true
const socketCorsOrigin = (origin, callback) => {
  console.log(`[Socket.IO CORS] Request from origin: ${origin}`);
  console.log(`[Socket.IO CORS] Allowed origins:`, allowedOrigins);
  console.log(`[Socket.IO CORS] Allow all origins:`, allowAllOrigins);

  // If no origin (e.g., same-origin or non-browser request), allow if we have fallback
  if (!origin) {
    console.log(
      `[Socket.IO CORS] No origin provided, using fallback: ${fallbackOrigin}`
    );
    if (fallbackOrigin) {
      return callback(null, fallbackOrigin);
    }
    return callback(new Error("Not allowed by CORS"));
  }

  // Check if origin is in allowed list
  if (allowAllOrigins) {
    // Never return wildcard with credentials, return the specific origin
    console.log(
      `[Socket.IO CORS] Allowing origin (all origins mode): ${origin}`
    );
    return callback(null, origin);
  }

  if (normalizedAllowedOrigins?.has(origin.toLowerCase())) {
    console.log(`[Socket.IO CORS] Allowing origin (matched): ${origin}`);
    return callback(null, origin);
  }

  console.warn(`[CORS] Rejected Socket.IO connection from origin: ${origin}`);
  return callback(new Error("Not allowed by CORS"));
};

const io = new Server(server, {
  cors: {
    origin: socketCorsOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  },
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    console.log(`[Socket.IO allowRequest] Origin: ${origin}`);

    if (!origin) {
      console.log(`[Socket.IO allowRequest] No origin, allowing with fallback`);
      return callback(null, true);
    }

    if (normalizedAllowedOrigins?.has(origin.toLowerCase())) {
      console.log(`[Socket.IO allowRequest] Origin allowed: ${origin}`);
      return callback(null, true);
    }

    console.warn(`[Socket.IO allowRequest] Origin rejected: ${origin}`);
    return callback("Origin not allowed", false);
  },
});

// Redis adapter removed by request; single-instance Socket.IO only.

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Removed local static uploads; Cloudinary serves media

// Minimal REST API (presence, uploads, health)
app.use("/api", apiRouter);

// Root
app.get("/", (_req, res) => res.send("Chat server is running!"));

// Start sockets only; Python handles DB-backed APIs and persistence.
(async () => {
  try {
    setupGroupSocketHandlers(io);
    setupDmSocketHandlers(io);
  } catch (e) {
    console.error("Socket setup failed.", e);
    process.exit(1);
  }

  server.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
})();

// Graceful shutdown
process.on("SIGINT", async () => {
  process.exit(0);
});

// Global guards to avoid crashing on unhandled rejections/timeouts
process.on("unhandledRejection", (reason) => {
  console.warn(
    "[unhandledRejection]",
    reason && reason.message ? reason.message : reason
  );
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err && err.message ? err.message : err);
});
