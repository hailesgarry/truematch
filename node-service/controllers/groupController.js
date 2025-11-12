const pyClient = require("../lib/pyClient");

class GroupController {
  constructor() {
    this._cache = new Map();
    this._ttlMs = 10_000;
  }

  _normalizeKey(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  _now() {
    return Date.now();
  }

  _getFromCache(key) {
    const normalized = this._normalizeKey(key);
    if (!normalized) return null;
    const entry = this._cache.get(normalized);
    if (!entry) return null;
    if (this._now() - entry.at > this._ttlMs) {
      this._cache.delete(normalized);
      return null;
    }
    return entry.group;
  }

  _storeInCache(group) {
    if (!group) return;
    const keys = new Set();
    if (group.id) keys.add(this._normalizeKey(group.id));
    if (group.databaseId) keys.add(this._normalizeKey(group.databaseId));
    for (const key of keys) {
      if (!key) continue;
      this._cache.set(key, { group, at: this._now() });
    }
  }

  getAllGroups() {
    const map = Object.create(null);
    for (const { group } of this._cache.values()) {
      if (group?.id) {
        map[group.id] = group;
      }
    }
    return map;
  }

  getGroup(groupId) {
    return this._getFromCache(groupId);
  }

  async ensureGroup(groupId) {
    const cached = this._getFromCache(groupId);
    if (cached) return cached;
    const key = this._normalizeKey(groupId);
    if (!key) return null;
    try {
      const data = await pyClient.getGroup(key);
      if (!data) return null;
      this._storeInCache(data);
      return data;
    } catch (e) {
      console.warn("[groupController] getGroup failed", e?.message || e);
      return null;
    }
  }

  addGroup(groupData) {
    this._storeInCache(groupData);
    return groupData;
  }

  updateGroup(groupId, groupData) {
    const existing = this.getGroup(groupId) || { id: groupId };
    const merged = { ...existing, ...groupData };
    this._storeInCache(merged);
    return merged;
  }

  deleteGroup(groupId) {
    const key = this._normalizeKey(groupId);
    if (!key) return true;
    this._cache.delete(key);
    return true;
  }
}

module.exports = new GroupController();
