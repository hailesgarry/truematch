const messageModel = require("../models/message");

class MessageController {
  getMessages(groupId) {
    return messageModel.getMessagesByGroup(groupId);
  }

  async getLatestWindow(groupId, count) {
    return messageModel.getLatestWindow(groupId, count);
  }

  async page(groupId, { before, limit }) {
    return messageModel.page(groupId, { before, limit });
  }

  async streamMetrics(groupId) {
    return messageModel.streamMetrics(groupId);
  }

  createMessage(groupId, messageData) {
    const timestamp = new Date().toISOString();
    const message = {
      ...messageData,
      timestamp,
    };

    return messageModel.addMessage(groupId, message);
  }

  editMessage(groupId, username, timestamp, newText) {
    return messageModel.editMessage(groupId, username, timestamp, newText);
  }

  deleteMessage(groupId, username, timestamp) {
    return messageModel.deleteMessage(groupId, username, timestamp);
  }

  updateUserBubbleColor(groupId, username, bubbleColor) {
    return messageModel.updateUserBubbleColorInMessages(
      groupId,
      username,
      bubbleColor
    );
  }

  getMessageByTimestamp(groupId, timestamp) {
    return messageModel.getMessageByTimestamp(groupId, timestamp);
  }

  getMessageById(groupId, messageId) {
    return messageModel.getMessageById(groupId, messageId);
  }

  editMessageById(groupId, messageId, newText) {
    return messageModel.editMessageById(groupId, messageId, newText);
  }

  deleteMessageById(groupId, messageId) {
    return messageModel.deleteMessageById(groupId, messageId);
  }

  updateUserProfile(userId, { username, avatar }) {
    return messageModel.updateUserProfile(userId, { username, avatar });
  }

  updateReactionById(groupId, messageId, user, emoji) {
    return messageModel.updateReactionById(groupId, messageId, user, emoji);
  }

  updateReactionByTimestamp(groupId, timestamp, user, emoji) {
    return messageModel.updateReactionByTimestamp(
      groupId,
      timestamp,
      user,
      emoji
    );
  }
}

module.exports = new MessageController();
