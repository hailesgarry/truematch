#!/usr/bin/env node
require("dotenv").config();
const { connect, disconnect } = require("../config/redis");
const storage = require("../models/storage");

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

(async () => {
  const arg = process.argv.slice(2).join(" ").trim();
  if (!arg) {
    console.error("Usage: node scripts/remove-group.js <group-id-or-name>");
    process.exit(1);
  }

  try {
    await connect();
    const groupsObj = (await storage.getGroups()) || {};
    const keys = Object.keys(groupsObj);
    if (!keys.length) {
      console.log("No groups found in Redis.");
      process.exit(0);
    }

    const needle = arg.toLowerCase();
    const needleSlug = slugify(arg);

    let targetId = null;
    for (const id of keys) {
      const g = groupsObj[id];
      if (!g) continue;
      const name = (g.name || "").toLowerCase();
      const idLc = String(id).toLowerCase();
      const nameSlug = slugify(g.name || "");
      if (
        idLc === needle ||
        name === needle ||
        idLc === needleSlug ||
        nameSlug === needleSlug
      ) {
        targetId = id;
        break;
      }
    }

    if (!targetId) {
      console.error(
        `No matching group for "${arg}". Available ids: ${keys.join(", ")}`
      );
      process.exit(2);
    }

    const target = groupsObj[targetId];
    console.log("Deleting group:", { id: targetId, name: target?.name });

    // Remove from app:groups map
    delete groupsObj[targetId];
    await storage.setGroups(groupsObj);

    // Remove associated message/stream/reaction/overlay keys
    try {
      const ok = await storage.deleteGroup(targetId);
      console.log("Deleted Redis message keys:", ok);
    } catch (e) {
      console.warn("Warning: failed deleting message keys:", e?.message || e);
    }

    console.log("Done.");
  } catch (e) {
    console.error("Error:", e?.message || e);
    process.exit(3);
  } finally {
    try {
      await disconnect();
    } catch {}
  }
})();
