const userModel = require("../models/user");

class UserController {
  addUser(...args) {
    return userModel.addUser(...args);
  }
  getUser(...args) {
    return userModel.getUser(...args);
  }
  updateUser(...args) {
    return userModel.updateUser(...args);
  }
  removeUser(...args) {
    return userModel.removeUser(...args);
  }
  getUsersByGroup(...args) {
    return userModel.getUsersByGroup(...args);
  }
  getAllUsers() {
    return userModel.getAllUsers();
  }
  getOnlineCounts() {
    return userModel.getOnlineCounts();
  }
}

module.exports = new UserController();
