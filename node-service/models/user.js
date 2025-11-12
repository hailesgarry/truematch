class UserModel {
  constructor() {
    // socket.id -> user data
    // user: { userId, username, avatar, bubbleColor, groups: string[], activeGroupId, ... }
    this.users = {};
  }

  addUser(socketId, userData) {
    const groups = Array.from(
      new Set(
        userData.groups
          ? userData.groups
          : userData.groupId
          ? [userData.groupId]
          : []
      )
    );
    const activeGroupId = userData.activeGroupId || groups[0] || null;
    this.users[socketId] = {
      ...userData,
      groups,
      activeGroupId,
      // legacy mirror
      groupId: activeGroupId,
      filtersByGroup: userData.filtersByGroup || {},
      filtersFetchedAt:
        typeof userData.filtersFetchedAt === "number"
          ? userData.filtersFetchedAt
          : null,
    };
    return this.users[socketId];
  }

  getUser(socketId) {
    return this.users[socketId] || null;
  }

  updateUser(socketId, userData) {
    const existing = this.users[socketId];
    if (!existing) return null;

    let groups = existing.groups;
    if (userData.groups) {
      groups = Array.from(new Set(userData.groups));
    } else if (userData.groupId) {
      if (!groups.includes(userData.groupId)) {
        groups = [...groups, userData.groupId];
      }
    }

    let activeGroupId =
      userData.activeGroupId !== undefined
        ? userData.activeGroupId
        : existing.activeGroupId;

    if (activeGroupId && !groups.includes(activeGroupId) && groups.length) {
      // ensure activeGroupId is valid
      activeGroupId = groups[0];
    }
    this.users[socketId] = {
      ...existing,
      ...userData,
      groups,
      activeGroupId,
      groupId: activeGroupId, // legacy mirror
    };
    return this.users[socketId];
  }

  removeUser(socketId) {
    const user = this.users[socketId];
    if (user) delete this.users[socketId];
    return user;
  }

  getUsersByGroup(groupId) {
    if (!groupId) return [];
    return Object.values(this.users)
      .filter((u) => u.groups?.includes(groupId) && !u.pendingDisconnect)
      .map((u) => ({
        userId: u.userId, // ADDED
        username: u.username,
        avatar: u.avatar,
        bubbleColor: u.bubbleColor,
      }));
  }

  getAllGroups() {
    const groupIds = new Set();
    Object.values(this.users).forEach((u) => {
      if (!u.pendingDisconnect) {
        (u.groups || []).forEach((g) => groupIds.add(g));
      }
    });
    return Array.from(groupIds);
  }

  getAllUsers() {
    return Object.values(this.users);
  }

  getOnlineCounts() {
    const counts = {};
    Object.values(this.users).forEach((u) => {
      if (!u.pendingDisconnect && u.groups) {
        u.groups.forEach((g) => (counts[g] = (counts[g] || 0) + 1));
      }
    });
    return counts;
  }

  findUserByIdAndGroup(userId, groupId) {
    for (const [socketId, u] of Object.entries(this.users)) {
      if (u.userId === userId && u.groups?.includes(groupId)) {
        return { socketId, user: u };
      }
    }
    return null;
  }
}

module.exports = new UserModel();
