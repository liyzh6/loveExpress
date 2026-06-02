const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const cors = require("cors");
const express = require("express");
const morgan = require("morgan");
const multer = require("multer");

const db = require("./db");
const payment = require("./payment");
const storage = require("./storage");
const wechat = require("./wechat");
const refundAndDispute = require("./refund-and-dispute");

const app = express();
const PORT = Number(process.env.PORT || 80);
const UPLOAD_DIR = path.join(__dirname, "uploads");
const PUBLIC_DIR = path.join(__dirname, "public");
const sessions = new Map();

const ORDER_STATUS = {
  pendingPay: "待支付",
  pendingAccept: "待接单",
  accepted: "已接单",
  making: "制作中",
  delivered: "已配送",
  completed: "已完成"
};

const PAYMENT_STATUS = {
  pending: "待支付",
  paid: "已支付",
  refunded: "已退款"
};

function markOrderPaid(store, order, detail) {
  order.paymentStatus = PAYMENT_STATUS.paid;
  if (order.status === ORDER_STATUS.pendingPay || !order.status) {
    order.status = ORDER_STATUS.pendingAccept;
  }
  order.paidAt = order.paidAt || db.localDate();
  order.escrowStatus = "平台账户已收款";
  order.settlementStatus = "平台托管";
  logOperation(store, "system", "payment.paid", order.id, detail || "支付成功，资金进入平台托管");
  return order;
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.use(cors());
app.use(morgan("dev"));

app.post("/api/payments/wechat/notify", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const rawBody = req.body.toString("utf8");
    if (!payment.verifyNotifySignature(req.headers, rawBody)) {
      throw new Error("微信支付回调验签失败");
    }
    const payload = JSON.parse(rawBody);
    const transaction = payment.decryptNotifyResource(payload.resource);
    db.withDb((store) => {
      const order = store.orders.find((item) => item.id === transaction.out_trade_no);
      if (order) {
        order.transactionId = transaction.transaction_id;
        markOrderPaid(store, order, "微信支付回调确认支付成功");
      }
    });
    res.json({ code: "SUCCESS", message: "成功" });
  } catch (error) {
    res.status(400).json({ code: "FAIL", message: error.message || "失败" });
  }
});

app.post("/api/payments/wechat/refund-notify", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const rawBody = req.body.toString("utf8");
    if (!payment.verifyNotifySignature(req.headers, rawBody)) {
      throw new Error("微信退款回调验签失败");
    }
    const payload = JSON.parse(rawBody);
    const refund = payment.decryptNotifyResource(payload.resource);
    db.withDb((store) => {
      const order = store.orders.find((item) => item.id === refund.out_trade_no);
      if (order && refund.refund_status === "SUCCESS") {
        order.status = "已退款";
        order.paymentStatus = "已退款";
        order.settlementStatus = "已退款";
        logOperation(store, "system", "refund.notify", order.id, "微信退款回调确认退款成功");
      }
    });
    res.json({ code: "SUCCESS", message: "成功" });
  } catch (error) {
    res.status(400).json({ code: "FAIL", message: error.message || "失败" });
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use("/assets", express.static(PUBLIC_DIR, {
  maxAge: "7d",
  etag: true
}));

function nowIso() {
  return new Date().toISOString();
}

function addHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function logOperation(store, actorId, action, targetId, detail) {
  store.operationLogs = store.operationLogs || [];
  store.operationLogs.unshift({
    id: `L${Date.now()}${Math.floor(Math.random() * 1000)}`,
    actorId,
    action,
    targetId,
    detail,
    createdAt: nowIso()
  });
}

function autoConfirmExpiredOrders() {
  const hours = Number(process.env.AUTO_CONFIRM_HOURS || 72);
  db.withDb((store) => {
    store.orders.forEach((order) => {
      if (order.status === "已配送" && order.autoConfirmAt && new Date(order.autoConfirmAt).getTime() <= Date.now()) {
        order.status = "已完成";
        order.completedAt = db.localDate();
        order.settlementStatus = "平台托管，待人工结算";
        order.settlementMode = "自动确认";
        logOperation(store, "system", "order.auto_complete", order.id, `配送后${hours}小时自动确认收货`);
      }
    });
  });
}

function getUser(req) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  return sessions.get(token);
}

function requireRole(roles) {
  return (req, res, next) => {
    const user = getUser(req);
    if (!user) {
      res.status(401).json({ message: "请先登录" });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ message: "没有权限访问该资源" });
      return;
    }
    req.user = user;
    next();
  };
}

function publicPost(post, user) {
  const likedBy = post.likedBy || [];
  return Object.assign({}, post, {
    likes: likedBy.length,
    likedByMe: user ? likedBy.includes(user.id) : false
  });
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function isValidMainlandMobile(phone) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone));
}

function validateOrderPayload(body) {
  const receiver = String(body.receiver || "").trim();
  const phone = normalizePhone(body.phone);
  const address = String(body.address || "").trim();
  if (!receiver) throw new Error("请填写收花人");
  if (!isValidMainlandMobile(phone)) throw new Error("手机号格式不正确");
  if (address.length < 6) throw new Error("配送地址不完整");
  if (body.location) {
    const latitude = Number(body.location.latitude);
    const longitude = Number(body.location.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("配送定位信息不正确");
  }
  return { receiver, phone, address };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "aide-express", date: db.localDate() });
});

app.get("/api/deploy-info", (req, res) => {
  res.json({
    ok: true,
    service: "aide-express",
    entry: "server/index.js",
    features: ["login", "orders", "community", "bouquet-assets", "wechat-pay"],
    storage: db.storageMode(),
    deployedAt: process.env.DEPLOYED_AT || "local"
  });
});

app.get("/api/payments/wechat/config", requireRole(["admin"]), (req, res) => {
  res.json(payment.getConfigStatus());
});

app.get("/api/count", (req, res) => {
  res.json({ code: 0, data: 1 });
});

app.post("/api/count/:action", (req, res) => {
  res.json({ code: 0, data: req.params.action === "inc" ? 2 : 0 });
});

app.post("/api/register", (req, res, next) => {
  if (!req.body || !req.body.useWechatProfile) {
    next();
    return;
  }
  const nickname = String(req.body.nickname || "微信用户").trim();
  const baseUsername = String(req.body.username || nickname || `微信用户${Date.now()}`).trim();
  const password = String(req.body.password || "");
  if (baseUsername.length < 2 || password.length < 8) {
    res.status(400).json({ message: "请使用微信昵称注册，密码至少8位" });
    return;
  }
  wechat.verifyLoginCode(req.body.wechatCode).then((wechatSession) => {
    const user = db.withDb((store) => {
      const existingWechatUser = store.users.find((item) => item.wechatOpenid === wechatSession.openid && item.role === "customer");
      if (existingWechatUser) return existingWechatUser;
      let username = baseUsername;
      let suffix = 1;
      while (store.users.some((item) => item.username === username && item.role === "customer")) {
        suffix += 1;
        username = `${baseUsername}${suffix}`;
      }
      const nextUser = db.createUser(username, password, "customer", nickname || username);
      nextUser.wechatOpenid = wechatSession.openid;
      nextUser.wechatUnionid = wechatSession.unionid || "";
      nextUser.nickname = nickname || username;
      nextUser.avatarUrl = req.body.avatarUrl || "";
      nextUser.realNameStatus = "微信账号已绑定，未实名";
      store.users.push(nextUser);
      logOperation(store, nextUser.id, "user.register", nextUser.id, "用户通过微信 openid 绑定注册");
      return nextUser;
    });
    res.status(201).json({ user: db.publicUser(user), username: user.username });
  }).catch((error) => {
    res.status(400).json({ message: error.message || "微信注册失败" });
  });
});

app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (username.length < 3 || password.length < 6) {
    res.status(400).json({ message: "账号至少3位，密码至少6位" });
    return;
  }
  wechat.verifyLoginCode(req.body.wechatCode).then((wechatSession) => {
    const user = db.withDb((store) => {
      if (store.users.some((item) => item.username === username)) {
        throw new Error("账号已存在");
      }
      if (store.users.some((item) => item.wechatOpenid === wechatSession.openid)) {
        throw new Error("该微信账号已注册");
      }
      const nextUser = db.createUser(username, password, "customer", username);
      nextUser.wechatOpenid = wechatSession.openid;
      store.users.push(nextUser);
      logOperation(store, nextUser.id, "user.register", nextUser.id, "微信账号校验后注册用户");
      return nextUser;
    });
    res.status(201).json({ user: db.publicUser(user) });
  }).catch((error) => {
    res.status(400).json({ message: error.message || "注册失败" });
  });
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  let openid = "";
  try {
    if (req.body.wechatCode) {
      const wechatSession = await wechat.verifyLoginCode(req.body.wechatCode);
      openid = wechatSession.openid;
    }
    const user = db.withDb((store) => {
      const target = store.users.find((item) => item.username === username && item.role === req.body.role);
      if (!target || target.passwordHash !== db.hashPassword(password, target.salt)) {
        throw new Error("账号、密码或身份不正确");
      }
      if (openid && target.role === "customer") {
        const usedByOther = store.users.some((item) => item.id !== target.id && item.wechatOpenid === openid);
        if (usedByOther) throw new Error("该微信账号已绑定其他用户");
        if (!target.wechatOpenid) {
          target.wechatOpenid = openid;
          logOperation(store, target.id, "user.bind_wechat", target.id, "用户登录时绑定微信 openid");
        }
      }
      return target;
    });
    const token = crypto.randomBytes(24).toString("hex");
    const safeUser = db.publicUser(user);
    sessions.set(token, safeUser);
    res.json({ token, user: safeUser });
  } catch (error) {
    res.status(error.message === "账号、密码或身份不正确" ? 401 : 400).json({ message: error.message || "登录失败" });
  }
});

app.get("/api/accounts", requireRole(["admin"]), (req, res) => {
  const store = db.readDb();
  res.json({ users: store.users.map(db.publicUser) });
});

app.get("/api/orders", requireRole(["customer", "merchant", "admin"]), (req, res) => {
  autoConfirmExpiredOrders();
  const store = db.readDb();
  const orders = req.user.role === "customer"
    ? store.orders.filter((order) => order.customerId === req.user.id)
    : store.orders.filter((order) => req.user.role === "admin" || order.paymentStatus === PAYMENT_STATUS.paid || order.status !== ORDER_STATUS.pendingPay);
  res.json({ orders });
});

app.post("/api/orders", requireRole(["customer"]), (req, res) => {
  try {
    const delivery = validateOrderPayload(req.body);
    const order = db.withDb((store) => {
      const commission = Math.round((req.body.totalPrice || 0) * 0.12);
      const nextOrder = Object.assign({}, req.body, {
        receiver: delivery.receiver,
        phone: delivery.phone,
        address: delivery.address,
        id: `B${Date.now()}`,
        customerId: req.user.id,
        status: "待支付",
        paymentStatus: "待支付",
        createdAt: db.localDate(),
        commission,
        escrowAmount: req.body.totalPrice || 0,
        merchantReceivable: (req.body.totalPrice || 0) - commission,
        status: ORDER_STATUS.pendingPay,
        paymentStatus: PAYMENT_STATUS.pending,
        escrowStatus: "等待支付",
        settlementStatus: "平台托管"
      });
      store.orders.unshift(nextOrder);
      logOperation(store, req.user.id, "order.create", nextOrder.id, "用户创建订单，资金进入平台托管流程");
      return nextOrder;
    });
    res.status(201).json({ order });
  } catch (error) {
    res.status(400).json({ message: error.message || "下单失败" });
  }
});

app.patch("/api/orders/:id/status", requireRole(["merchant", "admin"]), (req, res) => {
  try {
    const order = db.withDb((store) => {
      const target = store.orders.find((item) => item.id === req.params.id);
      if (!target) throw new Error("订单不存在");
      const flow = [ORDER_STATUS.pendingAccept, ORDER_STATUS.accepted, ORDER_STATUS.making, ORDER_STATUS.delivered];
      if (flow.indexOf(req.body.status) !== flow.indexOf(target.status) + 1 && req.body.status !== target.status) {
        throw new Error("订单状态需要按顺序流转");
      }
      target.status = req.body.status;
      if (!target.settlementStatus) target.settlementStatus = "平台托管";
      if (req.body.status === "已配送") {
        target.deliveredAt = nowIso();
        target.autoConfirmAt = addHours(Number(process.env.AUTO_CONFIRM_HOURS || 72));
      }
      logOperation(store, req.user.id, "order.status", target.id, `订单状态更新为${req.body.status}`);
      return target;
    });
    res.json({ order });
  } catch (error) {
    res.status(error.message === "订单不存在" ? 404 : 400).json({ message: error.message });
  }
});

function receiveOrder(req, res) {
  try {
    const order = db.withDb((store) => {
      const target = store.orders.find((item) => item.id === req.params.id && item.customerId === req.user.id);
      if (!target) throw new Error("订单不存在");
      if (target.status !== "已配送") throw new Error("店家配送后才能确认收到");
      target.status = "已完成";
      target.settlementStatus = "平台托管，待人工结算";
      target.completedAt = db.localDate();
      logOperation(store, req.user.id, "order.receive", target.id, "用户确认收到，订单完成，资金仍在平台托管");
      return target;
    });
    res.json({ order });
  } catch (error) {
    res.status(error.message === "订单不存在" ? 404 : 400).json({ message: error.message });
  }
}

app.patch("/api/orders/:id/receive", requireRole(["customer"]), receiveOrder);
app.post("/api/orders/:id/receive", requireRole(["customer"]), receiveOrder);

app.get("/api/posts", requireRole(["customer", "admin"]), (req, res) => {
  const store = db.readDb();
  const statusMap = {
    pending: "待审核",
    approved: "已通过",
    rejected: "已拒绝"
  };
  const requestedStatus = statusMap[req.query.statusKey] || req.query.status;
  const posts = store.posts
    .filter((post) => {
      if (requestedStatus && post.status !== requestedStatus) return false;
      if (req.user.role === "admin") return true;
      return post.status === "已通过" || post.customerId === req.user.id;
    })
    .map((post) => publicPost(post, req.user));
  res.json({ posts });
});

app.post("/api/posts", requireRole(["customer"]), upload.single("image"), (req, res) => {
  if (!req.file && !req.body.fileID) {
    res.status(400).json({ message: "请上传晒图图片" });
    return;
  }
  try {
    const saveImage = req.file ? storage.saveUploadedFile(req.file) : storage.saveCloudFileId(req.body.fileID);
    Promise.resolve(saveImage).then((imageUrl) => {
      const post = db.withDb((store) => {
      const order = store.orders.find((item) => item.id === req.body.orderId && item.customerId === req.user.id);
      if (!order || order.status !== "已完成") throw new Error("确认收到后才能晒图");
      if (store.posts.some((item) => item.orderId === order.id)) throw new Error("该订单已提交过晒图");
      const nextPost = {
        id: `P${Date.now()}`,
        orderId: order.id,
        customerId: req.user.id,
        title: req.body.title,
        content: req.body.content,
        imageUrl,
        status: "待审核",
        createdAt: db.localDate(),
        approvedAt: "",
        specs: order.specs,
        likedBy: [],
        comments: []
      };
      store.posts.unshift(nextPost);
      logOperation(store, req.user.id, "post.create", nextPost.id, "用户提交社区晒图审核");
      return nextPost;
      });
      res.status(201).json({ post: publicPost(post, req.user) });
    }).catch((error) => {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(400).json({ message: error.message || "上传失败" });
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(400).json({ message: error.message || "上传失败" });
  }
});

app.patch("/api/posts/:id/review", requireRole(["admin"]), (req, res) => {
  try {
    const post = db.withDb((store) => {
      const target = store.posts.find((item) => item.id === req.params.id);
      if (!target) throw new Error("晒图不存在");
      target.status = req.body.status;
      target.approvedAt = req.body.status === "已通过" ? db.localDate() : "";
      logOperation(store, req.user.id, "post.review", target.id, `晒图审核：${req.body.status}`);
      return target;
    });
    res.json({ post });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
});

app.post("/api/posts/:id/like", requireRole(["customer"]), (req, res) => {
  try {
    const post = db.withDb((store) => {
      const target = store.posts.find((item) => item.id === req.params.id && item.status === "已通过");
      if (!target) throw new Error("晒图不存在");
      target.likedBy = target.likedBy || [];
      if (target.likedBy.includes(req.user.id)) {
        target.likedBy = target.likedBy.filter((id) => id !== req.user.id);
      } else {
        target.likedBy.push(req.user.id);
      }
      return target;
    });
    res.json({ post: publicPost(post, req.user) });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
});

app.post("/api/posts/:id/comments", requireRole(["customer"]), (req, res) => {
  try {
    const post = db.withDb((store) => {
      const target = store.posts.find((item) => item.id === req.params.id && item.status === "已通过");
      if (!target) throw new Error("晒图不存在");
      target.comments = target.comments || [];
      target.comments.push({ userName: req.user.name, content: req.body.content, createdAt: db.localDate() });
      logOperation(store, req.user.id, "post.comment", target.id, "用户评论社区晒图");
      return target;
    });
    res.status(201).json({ post: publicPost(post, req.user) });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
});

app.post("/api/orders/:id/payments/wechat/prepay", requireRole(["customer"]), async (req, res) => {
  const store = db.readDb();
  const order = store.orders.find((item) => item.id === req.params.id && item.customerId === req.user.id);
  if (!order) {
    res.status(404).json({ message: "订单不存在" });
    return;
  }
  const user = store.users.find((item) => item.id === req.user.id);
  try {
    const result = await payment.createJsapiPayment(order, user && user.wechatOpenid);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message || "微信支付下单失败" });
  }
});

app.post("/api/orders/:id/payments/wechat/success", requireRole(["customer"]), (req, res) => {
  try {
    const order = db.withDb((store) => {
      const target = store.orders.find((item) => item.id === req.params.id && item.customerId === req.user.id);
      if (!target) throw new Error("订单不存在");
      if (target.paymentStatus === PAYMENT_STATUS.paid) return target;
      target.clientPayConfirmedAt = nowIso();
      markOrderPaid(store, target, "用户端支付完成，订单进入店家接单流程");
      return target;
    });
    res.json({ order });
  } catch (error) {
    res.status(error.message === "订单不存在" ? 404 : 400).json({ message: error.message || "确认支付失败" });
  }
});

app.post("/api/orders/:id/refund-requests", requireRole(["customer"]), (req, res) => {
  try {
    const request = db.withDb((store) => {
      const order = store.orders.find((item) => item.id === req.params.id && item.customerId === req.user.id);
      if (!order) throw new Error("订单不存在");
      if (!refundAndDispute.canRefund(order)) throw new Error("当前订单状态不支持售后退款");
      order.status = "售后中";
      order.settlementStatus = "售后冻结";
      const next = {
        id: `RF${Date.now()}`,
        orderId: order.id,
        customerId: req.user.id,
        reason: req.body.reason || "用户申请退款",
        status: "待审核",
        createdAt: nowIso()
      };
      store.refundRequests.unshift(next);
      logOperation(store, req.user.id, "refund.create", order.id, next.reason);
      return next;
    });
    res.status(201).json({ refundRequest: request });
  } catch (error) {
    res.status(400).json({ message: error.message || "申请失败" });
  }
});

app.patch("/api/refund-requests/:id/review", requireRole(["admin"]), async (req, res) => {
  try {
    const reviewed = db.withDb((store) => {
      const request = store.refundRequests.find((item) => item.id === req.params.id);
      if (!request) throw new Error("售后申请不存在");
      const order = store.orders.find((item) => item.id === request.orderId);
      request.status = req.body.status;
      request.reviewedAt = nowIso();
      request.adminNote = req.body.note || "";
      if (order && req.body.status === "已通过") {
        order.status = "已退款";
        order.settlementStatus = "已退款";
      }
      if (order && req.body.status === "已拒绝") {
        order.status = "已配送";
        order.settlementStatus = "平台托管";
      }
      logOperation(store, req.user.id, "refund.review", request.orderId, `售后审核：${req.body.status}`);
      return { request, order };
    });
    if (req.body.status === "已通过" && reviewed.order) {
      reviewed.wechatRefund = await payment.requestRefund(reviewed.order, reviewed.request.reason);
    }
    res.json(reviewed);
  } catch (error) {
    res.status(400).json({ message: error.message || "审核失败" });
  }
});

app.post("/api/orders/:id/disputes", requireRole(["customer"]), (req, res) => {
  try {
    const dispute = db.withDb((store) => {
      const order = store.orders.find((item) => item.id === req.params.id && item.customerId === req.user.id);
      if (!order) throw new Error("订单不存在");
      if (!refundAndDispute.canDispute(order)) throw new Error("当前订单状态不支持争议");
      order.status = "争议中";
      order.settlementStatus = "争议冻结";
      const next = {
        id: `D${Date.now()}`,
        orderId: order.id,
        customerId: req.user.id,
        reason: req.body.reason || "用户发起争议",
        status: "待仲裁",
        createdAt: nowIso()
      };
      store.disputes.unshift(next);
      logOperation(store, req.user.id, "dispute.create", order.id, next.reason);
      return next;
    });
    res.status(201).json({ dispute });
  } catch (error) {
    res.status(400).json({ message: error.message || "发起争议失败" });
  }
});

app.patch("/api/disputes/:id/resolve", requireRole(["admin"]), (req, res) => {
  try {
    const result = db.withDb((store) => {
      const dispute = store.disputes.find((item) => item.id === req.params.id);
      if (!dispute) throw new Error("争议不存在");
      const order = store.orders.find((item) => item.id === dispute.orderId);
      dispute.status = "已仲裁";
      dispute.resolution = req.body.resolution || "平台已处理";
      dispute.resolvedAt = nowIso();
      if (order) {
        if (req.body.result === "refund") {
          order.status = "已退款";
          order.settlementStatus = "已退款";
        } else {
          order.status = "已完成";
          order.settlementStatus = "平台托管，待人工结算";
        }
      }
      logOperation(store, req.user.id, "dispute.resolve", dispute.orderId, dispute.resolution);
      return { dispute, order };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message || "仲裁失败" });
  }
});

app.get("/api/operation-logs", requireRole(["admin"]), (req, res) => {
  const store = db.readDb();
  res.json({ logs: store.operationLogs || [] });
});

app.use((req, res) => {
  res.status(404).json({ message: "接口不存在" });
});

db.initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`爱的 Express API listening on ${PORT}, storage=${db.storageMode()}`);
  });
}).catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});
