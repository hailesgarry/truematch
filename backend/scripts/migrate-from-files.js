require("dotenv").config();
const fs = require("fs");
const path = require("path");
const redis = require("../config/redis");
const storage = require("../models/storage");

function readJsonIfExists(p, fallback) {
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn(`Failed reading ${p}:`, e?.message || e);
  }
  return fallback;
}

function ensureMessageIds(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const genId = () =>
    (
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10)
    ).toLowerCase();
  for (const [gid, arr] of Object.entries(obj)) {
    if (!Array.isArray(arr)) continue;
    arr.forEach((m) => {
      if (!m.messageId) m.messageId = genId();
      if (!Array.isArray(m.edits)) m.edits = [];
      if (m.lastEditedAt === undefined) m.lastEditedAt = null;
      if (m.edited === undefined) m.edited = false;
    });
  }
  return obj;
}

(async () => {
  const dataDir = path.join(__dirname, "..", "data");
  console.log("Starting migration from files in:", dataDir);
  try {
    await redis.connect();

    // Groups
    try {
      const groupsInRedis = (await storage.getGroups()) || {};
      if (!Object.keys(groupsInRedis).length) {
        const groupsPath = path.join(dataDir, "groups.json");
        const fileGroups = readJsonIfExists(groupsPath, null);
        if (fileGroups && typeof fileGroups === "object") {
          await storage.setGroups(fileGroups);
          console.log(`Imported ${Object.keys(fileGroups).length} groups`);
        } else {
          console.log("No groups to import or file missing.");
        }
      } else {
        console.log(
          `Skip groups: ${Object.keys(groupsInRedis).length} already in Redis`
        );
      }
    } catch (e) {
      console.warn("Groups migration skipped due to error:", e?.message || e);
    }

    // Messages
    try {
      const existingMsgGroups = await storage.listMessageGroupIds();
      if (!existingMsgGroups.length) {
        const msgsPath = path.join(dataDir, "chat_messages.json");
        const fileMsgs = readJsonIfExists(msgsPath, null);
        if (fileMsgs && typeof fileMsgs === "object") {
          ensureMessageIds(fileMsgs);
          let total = 0;
          for (const [gid, arr] of Object.entries(fileMsgs)) {
            await storage.setMessages(gid, Array.isArray(arr) ? arr : []);
            total += Array.isArray(arr) ? arr.length : 0;
          }
          console.log(
            `Imported messages for ${
              Object.keys(fileMsgs).length
            } groups (${total} total)`
          );
        } else {
          console.log("No chat messages to import or file missing.");
        }
      } else {
        console.log(
          `Skip messages: ${existingMsgGroups.length} groups already in Redis`
        );
      }
    } catch (e) {
      console.warn("Messages migration skipped due to error:", e?.message || e);
    }

    // Dating profiles
    try {
      const profiles = (await storage.getProfiles()) || [];
      if (!profiles.length) {
        const pPath = path.join(dataDir, "dating_profiles.json");
        const file = readJsonIfExists(pPath, null);
        if (Array.isArray(file) && file.length) {
          await storage.setProfiles(file);
          console.log(`Imported ${file.length} dating profiles`);
        } else {
          console.log("No dating profiles to import or file missing.");
        }
      } else {
        console.log(
          `Skip dating profiles: ${profiles.length} already in Redis`
        );
      }
    } catch (e) {
      console.warn(
        "Dating profiles migration skipped due to error:",
        e?.message || e
      );
    }

    // Dating likes
    try {
      const likes = (await storage.getLikes()) || [];
      if (!likes.length) {
        const p = path.join(dataDir, "dating_likes.json");
        const file = readJsonIfExists(p, null);
        if (Array.isArray(file) && file.length) {
          await storage.setLikes(file);
          console.log(`Imported ${file.length} dating likes`);
        } else {
          console.log("No dating likes to import or file missing.");
        }
      } else {
        console.log(`Skip dating likes: ${likes.length} already in Redis`);
      }
    } catch (e) {
      console.warn(
        "Dating likes migration skipped due to error:",
        e?.message || e
      );
    }

    // User bios
    try {
      const bios = (await storage.getBios()) || {};
      if (!Object.keys(bios).length) {
        const p = path.join(dataDir, "user_bios.json");
        const file = readJsonIfExists(p, null);
        if (file && typeof file === "object" && Object.keys(file).length) {
          await storage.setBios(file);
          console.log(`Imported ${Object.keys(file).length} user bios`);
        } else {
          console.log("No user bios to import or file missing.");
        }
      } else {
        console.log(`Skip bios: ${Object.keys(bios).length} already in Redis`);
      }
    } catch (e) {
      console.warn("Bios migration skipped due to error:", e?.message || e);
    }

    // Social links
    try {
      const links = (await storage.getSocialLinks()) || {};
      if (!Object.keys(links).length) {
        const p = path.join(dataDir, "user_social_links.json");
        const file = readJsonIfExists(p, null);
        if (file && typeof file === "object" && Object.keys(file).length) {
          await storage.setSocialLinks(file);
          console.log(
            `Imported social links for ${Object.keys(file).length} users`
          );
        } else {
          console.log("No social links to import or file missing.");
        }
      } else {
        console.log(
          `Skip social links: ${Object.keys(links).length} already in Redis`
        );
      }
    } catch (e) {
      console.warn(
        "Social links migration skipped due to error:",
        e?.message || e
      );
    }

    console.log("Migration complete.");
  } catch (e) {
    console.error("Migration failed:", e?.message || e);
    process.exitCode = 1;
  } finally {
    try {
      await redis.disconnect();
    } catch {}
  }
})();
