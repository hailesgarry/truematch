const py = require("./pyClient");

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  // Basic fetches
  getMessages(groupId) {
    // default window
    return this.getLatestWindow(
      groupId,
      Number(process.env.GROUP_MESSAGE_MAX || 100)
    );
  },
  async getLatestWindow(groupId, count) {
    const items = await py.latest(groupId, count);
    return Array.isArray(items) ? items : [];
  },
  async page(groupId, { before, limit } = {}) {
    const res = await py.page(groupId, before, limit);
    return res;
  },
  async streamMetrics(groupId) {
    const items = await py.latest(groupId, 1);
    if (!items || !items.length) return { length: 0 };
    return { length: items.length };
  },

  // Create
  async createMessage(groupId, messageData) {
    const saved = await py.send(groupId, messageData);
    return saved;
  },

  // Edit
  async editMessageById(groupId, messageId, newText) {
    const res = await py.edit(groupId, messageId, newText);
    return {
      success: true,
      lastEditedAt: res?.lastEditedAt || nowIso(),
      edited: true,
    };
  },
  async editMessage(groupId, username, timestamp, newText) {
    // Resolve by timestamp then edit by id
    const found = await this.getMessageByTimestamp(groupId, timestamp);
    if (!found) return { success: false, error: "Not found" };
    return this.editMessageById(groupId, found.messageId, newText);
  },

  // Delete
  async deleteMessageById(groupId, messageId) {
    await py.remove(groupId, messageId);
    return { success: true, deletedAt: nowIso() };
  },
  async deleteMessage(groupId, username, timestamp) {
    const found = await this.getMessageByTimestamp(groupId, timestamp);
    if (!found) return { success: false, error: "Not found" };
    return this.deleteMessageById(groupId, found.messageId);
  },

  // Reactions
  async updateReactionById(groupId, messageId, user, emoji) {
    const res = await py.react(groupId, messageId, emoji, user);
    return {
      success: true,
      messageId,
      summary: res?.summary || {},
      reactions: res?.reactions || {},
    };
  },
  async updateReactionByTimestamp(groupId, timestamp, user, emoji) {
    const found = await this.getMessageByTimestamp(groupId, timestamp);
    if (!found) return { success: false, error: "Not found" };
    return this.updateReactionById(groupId, found.messageId, user, emoji);
  },

  // Lookups
  async getMessageByTimestamp(groupId, ts) {
    return py.getByTimestamp(groupId, ts);
  },
  async getMessageById(groupId, id) {
    return py.getById(groupId, id);
  },

  // Misc used in socketHandler
  async updateUserBubbleColorInMessages(groupId, username, color) {
    try {
      const res = await py.updateUserBubbleColor(groupId, username, color);
      return !!(res && res.success !== false);
    } catch (e) {
      return false;
    }
  },
  // Back-compat alias used by socketHandler
  async updateUserBubbleColor(groupId, username, color) {
    return this.updateUserBubbleColorInMessages(groupId, username, color);
  },

  // Message filters
  async getMessageFiltersForUser(userId) {
    try {
      return await py.messageFilters(userId);
    } catch (e) {
      return { userId, items: [], groups: {} };
    }
  },
};
