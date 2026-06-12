const app = getApp();
const api = require("../../utils/api.js");

const STATUS = {
  pendingAccept: "待接单",
  accepted: "已接单",
  making: "制作中",
  delivered: "已配送",
  completed: "已完成",
  pendingPay: "待支付",
  paid: "已支付"
};

Page({
  data: {
    orders: [],
    pendingPosts: [],
    accounts: [],
    grossAmount: 0,
    commissionAmount: 0,
    activeOrderCount: 0
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
      const postRes = await api.request({ url: "/api/posts?statusKey=pending" });
      const accountRes = await api.request({ url: "/api/accounts" });
      const rawOrders = orderRes.orders || [];
      const orders = rawOrders
        .filter((order) => order.paymentStatus === STATUS.paid || order.status !== STATUS.pendingPay)
        .map((order) => this.decorateOrder(order));
      const grossAmount = orders.reduce((sum, order) => sum + (Number(order.totalPrice) || 0), 0);
      const commissionAmount = orders.reduce((sum, order) => sum + (Number(order.commission) || Math.round((Number(order.totalPrice) || 0) * 0.12)), 0);
      const activeOrderCount = orders.filter((order) => order.status !== STATUS.completed).length;

      this.setData({
        orders,
        pendingPosts: (postRes.posts || []).map((post) => Object.assign({}, post, {
          fullImageUrl: this.fullImageUrl(post.imageUrl)
        })),
        accounts: (accountRes.users || []).filter((user) => user.role !== "merchant"),
        grossAmount,
        commissionAmount,
        activeOrderCount
      });
    } catch (error) {
      wx.showToast({ title: error.message || "数据加载失败", icon: "none" });
    }
  },

  decorateOrder(order) {
    return Object.assign({}, order, {
      showAccept: order.status === STATUS.pendingAccept,
      showMaking: order.status === STATUS.accepted,
      showDeliver: order.status === STATUS.making,
      showWaitingConfirm: order.status === STATUS.delivered,
      showDone: order.status === STATUS.completed,
      previewImageUrl: this.fullImageUrl(order.previewImage)
    });
  },

  fullImageUrl(url) {
    if (!url) return "";
    if (url.indexOf("cloud://") === 0 || url.indexOf("http") === 0) return url;
    return `${app.globalData.apiBaseUrl}${url}`;
  },

  async updateStatus(event) {
    const id = event.currentTarget.dataset.id;
    const status = event.currentTarget.dataset.status;
    try {
      await api.request({ url: `/api/orders/${id}/status`, method: "PATCH", data: { status } });
      await this.loadDashboard();
      wx.showToast({ title: "订单已更新", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "更新失败", icon: "none" });
    }
  },

  async reviewPost(event) {
    const id = event.currentTarget.dataset.id;
    const status = event.currentTarget.dataset.status;
    try {
      await api.request({ url: `/api/posts/${id}/review`, method: "PATCH", data: { status } });
      await this.loadDashboard();
      wx.showToast({ title: status, icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "审核失败", icon: "none" });
    }
  }
});
