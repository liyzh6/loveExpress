App({
  globalData: {
    apiBaseUrl: "https://express-ydos-264225-8-1438597910.sh.run.tcloudbase.com",
    cloudEnv: "prod-d6g327e1r437e63ce",
    cloudService: "express-ydos",
    useCloudContainer: true,
    token: "",
    user: null
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: this.globalData.cloudEnv,
        traceUser: true
      });
    }
    this.globalData.token = wx.getStorageSync("token") || "";
    this.globalData.user = wx.getStorageSync("user") || null;
  },

  setSession(session) {
    this.globalData.token = session.token;
    this.globalData.user = session.user;
    wx.setStorageSync("token", session.token);
    wx.setStorageSync("user", session.user);
  },

  clearSession() {
    this.globalData.token = "";
    this.globalData.user = null;
    wx.removeStorageSync("token");
    wx.removeStorageSync("user");
  },

  logout() {
    this.clearSession();
    wx.reLaunch({ url: "/pages/login/login" });
  }
});
