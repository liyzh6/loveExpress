const app = getApp();
const api = require("../../utils/api.js");

Page({
  data: {
    orders: [],
    pendingPosts: [],
    accounts: [],
    grossAmount: 0,
    commissionAmount: 0
  },

  onShow() {
    if (!api.requireRole("admin")) return;
    this.loadDashboard();
  },

  logout() {
    app.logout();
  },

  async loadDashboard() {
    try {
      const orderRes = await api.request({ url: "/api/orders" });
      const postRes = await api.request({ url: "/api/posts?status=待审核" });
      const accountRes = await api.request({ url: "/api/accounts" });
      const orders = orderRes.orders || [];
      const posts = postRes.posts || [];
      const grossAmount = orders.reduce((sum, order) => sum + (order.totalPrice || 0), 0);
      const commissionAmount = orders.reduce((sum, order) => sum + (order.commission || Math.round((order.totalPrice || 0) * 0.12)), 0);
      this.setData({
        orders,
        pendingPosts: posts.map((post) => Object.assign({}, post, {
          fullImageUrl: `${app.globalData.apiBaseUrl}${post.imageUrl}`
        })),
        accounts: accountRes.users || [],
        grossAmount,
        commissionAmount
      });
    } catch (error) {
      wx.showToast({ title: error.message || "数据加载失败", icon: "none" });
    }
  },

  async reviewPost(event) {
    const id = event.currentTarget.dataset.id;
    const status = event.currentTarget.dataset.status;
    try {
      await api.request({ url: `/api/posts/${id}/review`, method: "PATCH", data: { status } });
      this.loadDashboard();
      wx.showToast({ title: status, icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "审核失败", icon: "none" });
    }
  }
});
