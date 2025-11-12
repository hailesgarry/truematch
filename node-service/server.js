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
const corsOptions = {
  origin: config.corsOrigin || "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: config.corsOrigin || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
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
