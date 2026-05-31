const app = getApp();
const api = require("../../utils/api.js");

Page({
  data: {
    username: "",
    password: ""
  },

  onLoad() {
    const saved = wx.getStorageSync("lastCustomerLogin") || {};
    this.setData({
      username: saved.username || "",
      password: saved.password || ""
    });
  },

  onUsernameInput(event) {
    this.setData({ username: event.detail.value.trim() });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value });
  },

  async register() {
    if (!this.validateForm()) return;
    try {
      const loginRes = await this.wxLogin();
      await api.request({
        url: "/api/register",
        method: "POST",
        data: {
          username: this.data.username,
          password: this.data.password,
          wechatCode: loginRes.code
        }
      });
      wx.setStorageSync("lastCustomerLogin", {
        username: this.data.username,
        password: this.data.password
      });
      wx.showToast({ title: "注册成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "注册失败", icon: "none" });
    }
  },

  loginCustomer() {
    this.loginWithRole("customer");
  },

  goMerchantLogin() {
    wx.navigateTo({ url: "/pages/merchant-login/merchant-login" });
  },

  goAdminLogin() {
    wx.navigateTo({ url: "/pages/admin-login/admin-login" });
  },

  validateForm() {
    if (!this.data.username || !this.data.password) {
      wx.showToast({ title: "请输入账号和密码", icon: "none" });
      return false;
    }
    return true;
  },

  async loginWithRole(role) {
    if (!this.validateForm()) return;
    try {
      const session = await api.request({
        url: "/api/login",
        method: "POST",
        data: {
          username: this.data.username,
          password: this.data.password,
          role
        }
      });
      app.setSession(session);
      if (role === "customer") {
        wx.setStorageSync("lastCustomerLogin", {
          username: this.data.username,
          password: this.data.password
        });
      }
      const pageMap = {
        customer: "/pages/customer/customer",
        merchant: "/pages/merchant/merchant",
        admin: "/pages/admin/admin"
      };
      wx.reLaunch({ url: pageMap[role] });
    } catch (error) {
      wx.showToast({ title: error.message || "登录失败", icon: "none" });
    }
  },

  wxLogin() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: resolve,
        fail: reject
      });
    });
  }
});
