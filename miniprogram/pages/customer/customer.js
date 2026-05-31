const app = getApp();
const api = require("../../utils/api.js");

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

Page({
  data: {
    activePanel: "customize",
    scenarioIndex: 0,
    flowerIndex: 0,
    paletteIndex: 0,
    layoutIndex: 0,
    wrapperIndex: 0,
    timeSlotIndex: 1,
    deliveryDate: formatDate(new Date()),
    receiver: "",
    phone: "",
    address: "",
    message: "愿这束花替我把今天变得更温柔。",
    messageTouched: false,
    orders: [],
    approvedPosts: [],
    timeSlots: ["09:00-12:00", "12:00-15:00", "15:00-18:00", "18:00-21:00"],
    scenarios: [
      { id: "birthday", name: "生日", tone: "明亮、祝福、热烈" },
      { id: "love", name: "表白", tone: "浪漫、直接、有记忆点" },
      { id: "anniversary", name: "纪念日", tone: "温柔、珍惜、长期陪伴" },
      { id: "visit", name: "探望", tone: "清新、安慰、不过分浓烈" }
    ],
    flowers: [
      { id: "rose", name: "玫瑰", price: 99, meaning: "爱与珍惜" },
      { id: "tulip", name: "郁金香", price: 129, meaning: "优雅告白" },
      { id: "lisianthus", name: "洋桔梗", price: 89, meaning: "真诚不变" },
      { id: "sunflower", name: "向日葵", price: 79, meaning: "明朗陪伴" }
    ],
    palettes: [
      { id: "pink", name: "粉白", colors: ["#f5a7b8", "#fff4f6", "#d9b6ff"], wrapColor: "#f8e7ea", ribbonColor: "#ce6d86" },
      { id: "champagne", name: "香槟", colors: ["#d8b26e", "#fff2cf", "#f0c7a3"], wrapColor: "#efe3cd", ribbonColor: "#9c7448" },
      { id: "red", name: "红黑", colors: ["#c7383f", "#f3dede", "#262626"], wrapColor: "#3c3534", ribbonColor: "#c7383f" },
      { id: "fresh", name: "橙黄", colors: ["#ffb02e", "#ffe58a", "#f27a35"], wrapColor: "#fff0cd", ribbonColor: "#d46b08" }
    ],
    layouts: [
      { id: "round", name: "经典圆束", desc: "饱满对称，适合大多数场景" },
      { id: "natural", name: "错落自然", desc: "层次明显，更像花艺师手作" },
      { id: "side", name: "单侧瀑布", desc: "视觉有方向感，适合纪念日" }
    ],
    wrappers: [
      { id: "korean", key: "korean", name: "韩素纸", price: 29, desc: "柔和哑光" },
      { id: "kraft", key: "kraft", name: "牛皮纸", price: 19, desc: "自然复古" },
      { id: "mesh", key: "mesh", name: "纱网", price: 39, desc: "轻盈通透" },
      { id: "premium", key: "premium", name: "欧雅纸", price: 49, desc: "挺括高级" }
    ],
    selectedScenario: {},
    selectedFlower: {},
    selectedPalette: {},
    selectedLayout: {},
    selectedWrapper: {},
    previewFlowers: [],
    totalPrice: 0
  },

  onLoad() {
    if (!api.requireRole("customer")) return;
    this.refreshSelection();
  },

  onShow() {
    if (!api.requireRole("customer")) return;
    this.loadOrders();
    this.loadPosts();
  },

  switchPanel(event) {
    this.setData({ activePanel: event.currentTarget.dataset.panel });
    this.loadOrders();
    this.loadPosts();
  },

  logout() {
    app.logout();
  },

  selectScenario(event) {
    this.setData({ scenarioIndex: Number(event.currentTarget.dataset.index) }, () => this.refreshSelection());
  },

  selectFlower(event) {
    this.setData({ flowerIndex: Number(event.currentTarget.dataset.index) }, () => this.refreshSelection());
  },

  selectPalette(event) {
    this.setData({ paletteIndex: Number(event.currentTarget.dataset.index) }, () => this.refreshSelection());
  },

  selectLayout(event) {
    this.setData({ layoutIndex: Number(event.currentTarget.dataset.index) }, () => this.refreshSelection());
  },

  selectWrapper(event) {
    this.setData({ wrapperIndex: Number(event.currentTarget.dataset.index) }, () => this.refreshSelection());
  },

  onDateChange(event) {
    this.setData({ deliveryDate: event.detail.value });
  },

  onTimeSlotChange(event) {
    this.setData({ timeSlotIndex: Number(event.detail.value) });
  },

  onReceiverInput(event) {
    this.setData({ receiver: event.detail.value });
  },

  onPhoneInput(event) {
    this.setData({ phone: event.detail.value });
  },

  onAddressInput(event) {
    this.setData({ address: event.detail.value });
  },

  onMessageInput(event) {
    this.setData({ message: event.detail.value, messageTouched: true });
  },

  refreshSelection() {
    const selectedScenario = this.data.scenarios[this.data.scenarioIndex];
    const selectedFlower = this.data.flowers[this.data.flowerIndex];
    const selectedPalette = this.data.palettes[this.data.paletteIndex];
    const selectedLayout = this.data.layouts[this.data.layoutIndex];
    const selectedWrapper = this.data.wrappers[this.data.wrapperIndex];
    const previewFlowers = this.buildPreview(selectedPalette, selectedLayout);
    const totalPrice = 99 + selectedFlower.price + selectedWrapper.price;
    const nextData = { selectedScenario, selectedFlower, selectedPalette, selectedLayout, selectedWrapper, previewFlowers, totalPrice };
    if (!this.data.messageTouched) {
      nextData.message = this.buildMessage(selectedScenario, selectedFlower);
    }
    this.setData(nextData);
  },

  buildMessage(scenario, flower) {
    const templates = {
      birthday: `愿${flower.name}把今天的祝福送到你身边，愿新的一岁明亮、顺心、被爱包围。`,
      love: `这束${flower.name}想替我说：遇见你之后，连普通日子都开始发光。`,
      anniversary: `用${flower.name}记住这一刻，也记住我们一路走来的温柔和坚定。`,
      visit: `送你一束${flower.name}，愿它带去一点明亮，也愿你慢慢恢复好心情。`
    };
    return templates[scenario.id] || `愿这束${flower.name}替我把心意送到你身边。`;
  },

  buildPreview(palette, layout) {
    const layoutMap = {
      round: [[48, 20, "large"], [34, 28, "medium"], [62, 30, "medium"], [42, 40, "medium"], [56, 42, "medium"], [48, 52, "large"], [30, 48, "small"], [68, 50, "small"], [38, 60, "small"], [58, 62, "small"]],
      natural: [[50, 14, "medium"], [35, 24, "large"], [63, 28, "small"], [44, 38, "medium"], [58, 44, "large"], [29, 48, "small"], [48, 56, "medium"], [68, 58, "small"], [38, 66, "small"]],
      side: [[38, 18, "large"], [50, 25, "medium"], [62, 35, "medium"], [44, 42, "medium"], [56, 52, "large"], [66, 62, "small"], [48, 67, "small"], [36, 57, "small"]]
    };
    const positions = layoutMap[layout.id] || layoutMap.round;
    return positions.map((position, index) => ({
      id: `${layout.id}-${index}`,
      size: position[2],
      style: `left:${position[0]}%;top:${position[1]}%;background:${palette.colors[index % palette.colors.length]};`
    }));
  },

  async submitOrder() {
    if (!this.data.receiver || !this.data.phone || !this.data.address) {
      wx.showToast({ title: "请填写收花人、电话和地址", icon: "none" });
      return;
    }
    const order = {
      receiver: this.data.receiver,
      phone: this.data.phone,
      address: this.data.address,
      deliveryTime: `${this.data.deliveryDate} ${this.data.timeSlots[this.data.timeSlotIndex]}`,
      message: this.data.message,
      totalPrice: this.data.totalPrice,
      commission: Math.round(this.data.totalPrice * 0.12),
      specs: {
        scenario: this.data.selectedScenario,
        flower: this.data.selectedFlower,
        palette: this.data.selectedPalette,
        layout: this.data.selectedLayout,
        wrapper: this.data.selectedWrapper
      },
      previewFlowers: this.data.previewFlowers
    };
    try {
      await api.request({ url: "/api/orders", method: "POST", data: order });
      this.setData({ activePanel: "orders", receiver: "", phone: "", address: "" });
      this.loadOrders();
      wx.showToast({ title: "下单成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "下单失败", icon: "none" });
    }
  },

  async loadOrders() {
    try {
      const orderRes = await api.request({ url: "/api/orders" });
      const postRes = await api.request({ url: "/api/posts" });
      const orders = orderRes.orders || [];
      const posts = postRes.posts || [];
      const enriched = orders.map((order) => {
        const post = posts.find((item) => item.orderId === order.id);
        const isDone = order.status === "已完成";
        return Object.assign({}, order, {
          canConfirmReceipt: order.status === "已配送",
          canShare: isDone && !post,
          postStatusText: post ? `晒图${post.status}` : ""
        });
      });
      this.setData({ orders: enriched });
    } catch (error) {
      wx.showToast({ title: error.message || "订单加载失败", icon: "none" });
    }
  },

  async loadPosts() {
    try {
      const res = await api.request({ url: "/api/posts?status=已通过" });
      const approvedPosts = (res.posts || []).map((post) => Object.assign({}, post, {
        fullImageUrl: `${app.globalData.apiBaseUrl}${post.imageUrl}`
      }));
      this.setData({ approvedPosts });
    } catch (error) {
      wx.showToast({ title: error.message || "社区加载失败", icon: "none" });
    }
  },

  async confirmReceipt(event) {
    const id = event.currentTarget.dataset.id;
    try {
      await api.request({ url: `/api/orders/${id}/receive`, method: "POST" });
      await this.loadOrders();
      wx.showToast({ title: "已确认收货", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "确认失败", icon: "none" });
    }
  },

  requestPostReview(event) {
    const orderId = event.currentTarget.dataset.id;
    const order = this.data.orders.find((item) => item.id === orderId);
    if (!order) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        try {
          await api.uploadPost({
            orderId,
            filePath: res.tempFiles[0].tempFilePath,
            title: `${order.specs.palette.name}${order.specs.flower.name}晒图`,
            content: `这束花送达啦：${order.message}`
          });
          this.loadOrders();
          wx.showToast({ title: "已提交审核", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "上传失败", icon: "none" });
        }
      }
    });
  },

  async likePost(event) {
    const id = event.currentTarget.dataset.id;
    await api.request({ url: `/api/posts/${id}/like`, method: "POST" });
    await this.loadPosts();
  },

  commentPost(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "写评论",
      editable: true,
      placeholderText: "例如：这个配色好温柔",
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        try {
          await api.request({ url: `/api/posts/${id}/comments`, method: "POST", data: { content: res.content } });
          this.loadPosts();
        } catch (error) {
          wx.showToast({ title: error.message || "评论失败", icon: "none" });
        }
      }
    });
  }
});
