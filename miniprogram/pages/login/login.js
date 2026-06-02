const app = getApp();
const api = require("../../utils/api.js");

function randomPassword() {
  return `wx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

Page({
  data: {
    username: "",
    password: "",
    nickname: ""
  },

  onLoad() {
    const saved = wx.getStorageSync("lastCustomerLogin") || {};
    this.setData({
      username: saved.username || "",
      password: saved.password || "",
      nickname: saved.nickname || ""
    });
  },

  onUsernameInput(event) {
    this.setData({ username: event.detail.value.trim() });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value });
  },

  onNicknameInput(event) {
    this.setData({ nickname: event.detail.value.trim() });
  },

  async register() {
    try {
      const profile = await this.getUserProfile();
      const loginRes = await this.wxLogin();
      const nickname = (profile.userInfo && profile.userInfo.nickName) || this.data.nickname || "微信用户";
      const password = randomPassword();
      const registerRes = await api.request({
        url: "/api/register",
        method: "POST",
        data: {
          useWechatProfile: true,
          username: nickname,
          nickname,
          avatarUrl: profile.userInfo && profile.userInfo.avatarUrl,
          password,
          wechatCode: loginRes.code
        }
      });
      const username = registerRes.username || (registerRes.user && registerRes.user.username) || nickname;
      wx.setStorageSync("lastCustomerLogin", { username, password, nickname });
      this.setData({ username, password, nickname });
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
      wx.showToast({ title: "请先注册或输入账号密码", icon: "none" });
      return false;
    }
    return true;
  },

  async loginWithRole(role) {
    if (!this.validateForm()) return;
    try {
      const loginRes = role === "customer" ? await this.wxLogin() : {};
      const session = await api.request({
        url: "/api/login",
        method: "POST",
        data: {
          username: this.data.username,
          password: this.data.password,
          role,
          wechatCode: loginRes.code || ""
        }
      });
      app.setSession(session);
      if (role === "customer") {
        wx.setStorageSync("lastCustomerLogin", {
          username: this.data.username,
          password: this.data.password,
          nickname: this.data.nickname
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
      wx.login({ success: resolve, fail: reject });
    });
  },

  getUserProfile() {
    return new Promise((resolve, reject) => {
      if (!wx.getUserProfile) {
        reject(new Error("当前基础库不支持微信资料授权"));
        return;
      }
      wx.getUserProfile({
        desc: "用于注册并展示你的微信昵称",
        success: resolve,
        fail: reject
      });
    });
  }
});
