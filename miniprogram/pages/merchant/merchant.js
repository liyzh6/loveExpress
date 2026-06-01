const app = getApp();
const api = require("../../utils/api.js");

Page({
  data: {
    orders: [],
    pendingCount: 0
  },

  onShow() {
    if (!api.requireRole("merchant")) return;
    this.loadOrders();
  },

  logout() {
    app.logout();
  },

  async loadOrders() {
    try {
      const res = await api.request({ url: "/api/orders" });
      const paidOrders = (res.orders || []).filter((order) => order.paymentStatus === "已支付" || order.status !== "待支付");
      const orders = paidOrders.map((order) => Object.assign({}, order, {
        showAccept: order.status === "待接单",
        showMaking: order.status === "已接单",
        showDeliver: order.status === "制作中",
        showWaitingConfirm: order.status === "已配送",
        showDone: order.status === "已完成"
      }));
      const pendingCount = orders.filter((order) => order.status !== "已完成").length;
      this.setData({ orders, pendingCount });
    } catch (error) {
      wx.showToast({ title: error.message || "订单加载失败", icon: "none" });
    }
  },

  async updateStatus(event) {
    const id = event.currentTarget.dataset.id;
    const status = event.currentTarget.dataset.status;
    try {
      await api.request({ url: `/api/orders/${id}/status`, method: "PATCH", data: { status } });
      this.loadOrders();
      wx.showToast({ title: "状态已更新", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "更新失败", icon: "none" });
    }
  }
});
