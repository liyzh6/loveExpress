const app = getApp();
const api = require("../../utils/api.js");

Page({
  data: {
    username: "",
    password: ""
  },

  onUsernameInput(event) {
    this.setData({ username: event.detail.value.trim() });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value });
  },

  async login() {
    if (!this.data.username || !this.data.password) {
      wx.showToast({ title: "请输入用户名和密码", icon: "none" });
      return;
    }
    try {
      const session = await api.request({
        url: "/api/login",
        method: "POST",
        data: {
          username: this.data.username,
          password: this.data.password,
          role: "merchant"
        }
      });
      app.setSession(session);
      wx.reLaunch({ url: "/pages/merchant/merchant" });
    } catch (error) {
      wx.showToast({ title: error.message || "登录失败", icon: "none" });
    }
  }
});
