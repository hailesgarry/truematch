const groupModel = require("../models/group");

class GroupController {
  getAllGroups() {
    return groupModel.getGroupsArray();
  }

  getGroup(groupId) {
    return groupModel.getGroup(groupId);
  }

  addGroup(groupData) {
    return groupModel.addGroup(groupData);
  }

  updateGroup(groupId, groupData) {
    return groupModel.updateGroup(groupId, groupData);
  }

  deleteGroup(groupId) {
    return groupModel.deleteGroup(groupId);
  }
}

module.exports = new GroupController();
