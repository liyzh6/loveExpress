const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const cors = require("cors");
const express = require("express");
const morgan = require("morgan");
const multer = require("multer");

const db = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 80);
const UPLOAD_DIR = path.join(__dirname, "uploads");
const sessions = new Map();

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use("/uploads", express.static(UPLOAD_DIR));

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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "aide-express", date: db.localDate() });
});

app.get("/api/count", (req, res) => {
  res.json({ code: 0, data: 1 });
});

app.post("/api/count/:action", (req, res) => {
  res.json({ code: 0, data: req.params.action === "inc" ? 2 : 0 });
});

app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (username.length < 3 || password.length < 6) {
    res.status(400).json({ message: "账号至少3位，密码至少6位" });
    return;
  }
  try {
    const user = db.withDb((store) => {
      if (store.users.some((item) => item.username === username)) {
        throw new Error("账号已存在");
      }
      const nextUser = db.createUser(username, password, "customer", username);
      store.users.push(nextUser);
      return nextUser;
    });
    res.status(201).json({ user: db.publicUser(user) });
  } catch (error) {
    res.status(400).json({ message: error.message || "注册失败" });
  }
});

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const store = db.readDb();
  const user = store.users.find((item) => item.username === username && item.role === req.body.role);
  if (!user || user.passwordHash !== db.hashPassword(password, user.salt)) {
    res.status(401).json({ message: "账号、密码或身份不正确" });
    return;
  }
  const token = crypto.randomBytes(24).toString("hex");
  const safeUser = db.publicUser(user);
  sessions.set(token, safeUser);
  res.json({ token, user: safeUser });
});

app.get("/api/accounts", requireRole(["admin"]), (req, res) => {
  const store = db.readDb();
  res.json({ users: store.users.map(db.publicUser) });
});

app.get("/api/orders", requireRole(["customer", "merchant", "admin"]), (req, res) => {
  const store = db.readDb();
  const orders = req.user.role === "customer"
    ? store.orders.filter((order) => order.customerId === req.user.id)
    : store.orders;
  res.json({ orders });
});

app.post("/api/orders", requireRole(["customer"]), (req, res) => {
  const order = db.withDb((store) => {
    const commission = Math.round((req.body.totalPrice || 0) * 0.12);
    const nextOrder = Object.assign({}, req.body, {
      id: `B${Date.now()}`,
      customerId: req.user.id,
      status: "待接单",
      createdAt: db.localDate(),
      commission,
      escrowAmount: req.body.totalPrice || 0,
      merchantReceivable: (req.body.totalPrice || 0) - commission,
      settlementStatus: "平台托管"
    });
    store.orders.unshift(nextOrder);
    return nextOrder;
  });
  res.status(201).json({ order });
});

app.patch("/api/orders/:id/status", requireRole(["merchant", "admin"]), (req, res) => {
  try {
    const order = db.withDb((store) => {
      const target = store.orders.find((item) => item.id === req.params.id);
      if (!target) throw new Error("订单不存在");
      const flow = ["待接单", "已接单", "制作中", "已配送"];
      if (flow.indexOf(req.body.status) !== flow.indexOf(target.status) + 1 && req.body.status !== target.status) {
        throw new Error("订单状态需要按顺序流转");
      }
      target.status = req.body.status;
      if (!target.settlementStatus) target.settlementStatus = "平台托管";
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
      target.settlementStatus = "已结算给店家";
      target.completedAt = db.localDate();
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
  const posts = store.posts
    .filter((post) => {
      if (req.query.status && post.status !== req.query.status) return false;
      if (req.user.role === "admin") return true;
      return post.status === "已通过" || post.customerId === req.user.id;
    })
    .map((post) => publicPost(post, req.user));
  res.json({ posts });
});

app.post("/api/posts", requireRole(["customer"]), upload.single("image"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: "请上传晒图图片" });
    return;
  }
  try {
    const post = db.withDb((store) => {
      const order = store.orders.find((item) => item.id === req.body.orderId && item.customerId === req.user.id);
      if (!order || order.status !== "已完成") throw new Error("确认收到后才能晒图");
      if (store.posts.some((item) => item.orderId === order.id)) throw new Error("该订单已提交过晒图");
      const ext = path.extname(req.file.originalname) || ".jpg";
      const filename = `${req.file.filename}${ext}`;
      fs.renameSync(req.file.path, path.join(UPLOAD_DIR, filename));
      const nextPost = {
        id: `P${Date.now()}`,
        orderId: order.id,
        customerId: req.user.id,
        title: req.body.title,
        content: req.body.content,
        imageUrl: `/uploads/${filename}`,
        status: "待审核",
        createdAt: db.localDate(),
        approvedAt: "",
        specs: order.specs,
        likedBy: [],
        comments: []
      };
      store.posts.unshift(nextPost);
      return nextPost;
    });
    res.status(201).json({ post: publicPost(post, req.user) });
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
      return target;
    });
    res.status(201).json({ post: publicPost(post, req.user) });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ message: "接口不存在" });
});

app.listen(PORT, () => {
  console.log(`爱的 Express API listening on ${PORT}`);
});
