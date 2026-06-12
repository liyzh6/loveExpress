const app = getApp();
const api = require("../../utils/api.js");

Page({
  data: {
    loggingIn: false
  },

  async loginCustomer() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true });
    try {
      const loginRes = await this.wxLogin();
      const session = await api.request({
        url: "/api/wechat-login",
        method: "POST",
        data: {
          wechatCode: loginRes.code
        }
      });
      app.setSession(session);
      wx.showToast({ title: "登录成功", icon: "success" });
      wx.reLaunch({ url: "/pages/customer/customer" });
    } catch (error) {
      wx.showToast({ title: error.message || "登录失败", icon: "none" });
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  goAdminLogin() {
    wx.navigateTo({ url: "/pages/admin-login/admin-login" });
  },

  wxLogin() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (res) => {
          if (res.code) {
            resolve(res);
            return;
          }
          reject(new Error("微信登录凭证获取失败"));
        },
        fail: reject
      });
    });
  }
});
