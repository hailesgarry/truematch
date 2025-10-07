const storage = require("./storage");

class GroupModel {
  constructor() {
    this.groups = {};
  }

  init() {
    (async () => {
      try {
        const existing = await storage.getGroups();
        if (existing && Object.keys(existing).length) {
          // Reconcile shape and clean obvious junk keys (non-object entries)
          const cleaned = {};
          let removed = 0;
          for (const [id, g] of Object.entries(existing)) {
            if (g && typeof g === "object" && g.id) cleaned[id] = g;
            else removed++;
          }
          this.groups = cleaned;
          if (removed) {
            await storage.setGroups(this.groups);
          }
          const count = Object.keys(this.groups).length;
          console.log(
            `Loaded ${count} groups from Redis${
              removed ? `; pruned ${removed} invalid entries` : ""
            }`
          );
        } else {
          // seed default
          this.groups = {
            general: {
              id: "general",
              name: "General Chat",
              description: "A general chat room for everyone",
            },
          };
          await storage.setGroups(this.groups);
          console.log("Initialized default groups in Redis");
        }
      } catch (err) {
        console.error("Error loading groups from Redis:", err);
        this.groups = {};
      }
    })();
  }

  saveGroups() {
    (async () => {
      try {
        await storage.setGroups(this.groups);
      } catch (err) {
        console.error("Error saving groups to Redis:", err);
      }
    })();
  }

  getAllGroups() {
    return this.groups;
  }

  getGroupsArray() {
    return Object.values(this.groups);
  }

  getGroup(groupId) {
    return this.groups[groupId] || null;
  }

  addGroup(group) {
    if (!group || !group.id) return null;
    this.groups[group.id] = group;
    this.saveGroups();
    return group;
  }

  updateGroup(groupId, groupData) {
    if (!this.groups[groupId]) return null;
    this.groups[groupId] = { ...this.groups[groupId], ...groupData };
    this.saveGroups();
    return this.groups[groupId];
  }

  deleteGroup(groupId) {
    if (!this.groups[groupId]) return false;
    delete this.groups[groupId];
    this.saveGroups();
    // Also remove messages for this group
    (async () => {
      try {
        await storage.deleteGroup(groupId);
      } catch {}
    })();
    return true;
  }
}

module.exports = new GroupModel();
