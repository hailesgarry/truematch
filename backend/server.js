const path = require("path");
// Ensure .env is loaded from the backend folder regardless of CWD
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const config = require("./config");
const apiRoutes = require("./routes/api");
const { setupSocket } = require("./socket/socketHandler");
const cors = require("cors");
const groupModel = require("./models/group");
const messageModel = require("./models/message");
const datingModel = require("./models/dating");
const redis = require("./config/redis");
const { getStatus: getCloudStatus } = require("./config/cloudinary");

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

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Removed local static uploads; Cloudinary serves media

// Routes
app.use("/api", apiRoutes);

// Root
app.get("/", (_req, res) => res.send("Chat server is running!"));

// Start after Redis connects (so models can rely on it)
(async () => {
  try {
    // Log Cloudinary status early (no secrets logged)
    try {
      const st = getCloudStatus ? getCloudStatus() : { configured: false };
      if (st.configured) {
        console.log(
          `Cloudinary configured (cloud: ${
            st.cloudName || "unknown"
          }, via URL: ${st.usingUrl ? "yes" : "no"})`
        );
      } else {
        console.log("Cloudinary not configured");
      }
    } catch {}

    await redis.connect();
    // Initialize models that load from Redis
    groupModel.init?.();
    messageModel.init?.();
    datingModel.init?.();
    // Wire sockets only after data layers are ready
    setupSocket(io);
  } catch (e) {
    console.error("Failed to connect to Redis. Exiting.", e);
    process.exit(1);
  }

  server.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
})();

// Graceful shutdown
process.on("SIGINT", async () => {
  try {
    await redis.disconnect();
  } catch {}
  process.exit(0);
});
