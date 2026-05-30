const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const cors = require("cors");
const express = require("express");
const morgan = require("morgan");
const multer = require("multer");

const app = express();
const PORT = Number(process.env.PORT || 80);
const DATA_FILE = path.join(__dirname, "data", "db.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const sessions = new Map();

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use("/uploads", express.static(UPLOAD_DIR));

function localDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function createUser(username, password, role, name, fixedId) {
  const salt = crypto.randomBytes(12).toString("hex");
  return {
    id: fixedId || `${role[0]}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
    username,
    role,
    name,
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: localDate()
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    createdAt: user.createdAt
  };
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function seedSystemAccounts(db) {
  const seeds = [
    { username: "user001", password: "123456", role: "customer", name: "默认用户", id: "u_1001" },
    { username: "merchant001", password: "123456", role: "merchant", name: "默认花店", id: "m_1001" },
    { username: "admin001", password: "123456", role: "admin", name: "平台管理员", id: "a_1001" }
  ];
  let changed = false;
  seeds.forEach((seed) => {
    if (!db.users.some((user) => user.username === seed.username && user.role === seed.role)) {
      db.users.push(createUser(seed.username, seed.password, seed.role, seed.name, seed.id));
      changed = true;
    }
  });
  if (changed) {
    writeDb(db);
  }
}

function readDb() {
  if (!fs.existsSync(DATA_FILE)) {
    writeDb({ users: [], orders: [], posts: [], comments: [] });
  }
  const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  db.users = db.users || [];
  db.orders = db.orders || [];
  db.posts = db.posts || [];
  db.comments = db.comments || [];
  seedSystemAccounts(db);
  return db;
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "aide-express", date: localDate() });
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
  const db = readDb();
  if (db.users.some((user) => user.username === username)) {
    res.status(400).json({ message: "账号已存在" });
    return;
  }
  const user = createUser(username, password, "customer", username);
  db.users.push(user);
  writeDb(db);
  res.status(201).json({ user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const db = readDb();
  const user = db.users.find((item) => item.username === username && item.role === req.body.role);
  if (!user || user.passwordHash !== hashPassword(password, user.salt)) {
    res.status(401).json({ message: "账号、密码或身份不正确" });
    return;
  }
  const token = crypto.randomBytes(24).toString("hex");
  const safeUser = publicUser(user);
  sessions.set(token, safeUser);
  res.json({ token, user: safeUser });
});

app.get("/api/accounts", requireRole(["admin"]), (req, res) => {
  const db = readDb();
  res.json({ users: db.users.map(publicUser) });
});

app.get("/api/orders", requireRole(["customer", "merchant", "admin"]), (req, res) => {
  const db = readDb();
  const orders = req.user.role === "customer"
    ? db.orders.filter((order) => order.customerId === req.user.id)
    : db.orders;
  res.json({ orders });
});

app.post("/api/orders", requireRole(["customer"]), (req, res) => {
  const db = readDb();
  const order = Object.assign({}, req.body, {
    id: `B${Date.now()}`,
    customerId: req.user.id,
    status: "待接单",
    createdAt: localDate(),
    commission: Math.round((req.body.totalPrice || 0) * 0.12)
  });
  db.orders.unshift(order);
  writeDb(db);
  res.status(201).json({ order });
});

app.patch("/api/orders/:id/status", requireRole(["merchant", "admin"]), (req, res) => {
  const db = readDb();
  const order = db.orders.find((item) => item.id === req.params.id);
  if (!order) {
    res.status(404).json({ message: "订单不存在" });
    return;
  }
  const flow = ["待接单", "已接单", "制作中", "已配送"];
  if (flow.indexOf(req.body.status) !== flow.indexOf(order.status) + 1 && req.body.status !== order.status) {
    res.status(400).json({ message: "订单状态需要按顺序流转" });
    return;
  }
  order.status = req.body.status;
  writeDb(db);
  res.json({ order });
});

app.get("/api/posts", requireRole(["customer", "admin"]), (req, res) => {
  const db = readDb();
  const posts = db.posts
    .filter((post) => {
      if (req.query.status && post.status !== req.query.status) return false;
      if (req.user.role === "admin") return true;
      if (req.query.status === "已通过") return true;
      return post.customerId === req.user.id || post.status === "已通过";
    })
    .map((post) => publicPost(post, req.user));
  res.json({ posts });
});

app.post("/api/posts", requireRole(["customer"]), upload.single("image"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: "请上传晒图图片" });
    return;
  }
  const db = readDb();
  const order = db.orders.find((item) => item.id === req.body.orderId && item.customerId === req.user.id);
  if (!order || order.status !== "已配送") {
    res.status(400).json({ message: "订单配送完成后才能晒图" });
    return;
  }
  if (db.posts.some((post) => post.orderId === order.id)) {
    res.status(400).json({ message: "该订单已提交过晒图" });
    return;
  }
  const ext = path.extname(req.file.originalname) || ".jpg";
  const filename = `${req.file.filename}${ext}`;
  fs.renameSync(req.file.path, path.join(UPLOAD_DIR, filename));
  const post = {
    id: `P${Date.now()}`,
    orderId: order.id,
    customerId: req.user.id,
    title: req.body.title,
    content: req.body.content,
    imageUrl: `/uploads/${filename}`,
    status: "待审核",
    createdAt: localDate(),
    approvedAt: "",
    specs: order.specs,
    likedBy: [],
    comments: []
  };
  db.posts.unshift(post);
  writeDb(db);
  res.status(201).json({ post: publicPost(post, req.user) });
});

app.patch("/api/posts/:id/review", requireRole(["admin"]), (req, res) => {
  const db = readDb();
  const post = db.posts.find((item) => item.id === req.params.id);
  if (!post) {
    res.status(404).json({ message: "晒图不存在" });
    return;
  }
  post.status = req.body.status;
  post.approvedAt = req.body.status === "已通过" ? localDate() : "";
  writeDb(db);
  res.json({ post });
});

app.post("/api/posts/:id/like", requireRole(["customer"]), (req, res) => {
  const db = readDb();
  const post = db.posts.find((item) => item.id === req.params.id && item.status === "已通过");
  if (!post) {
    res.status(404).json({ message: "晒图不存在" });
    return;
  }
  post.likedBy = post.likedBy || [];
  if (post.likedBy.includes(req.user.id)) {
    post.likedBy = post.likedBy.filter((id) => id !== req.user.id);
  } else {
    post.likedBy.push(req.user.id);
  }
  writeDb(db);
  res.json({ post: publicPost(post, req.user) });
});

app.post("/api/posts/:id/comments", requireRole(["customer"]), (req, res) => {
  const db = readDb();
  const post = db.posts.find((item) => item.id === req.params.id && item.status === "已通过");
  if (!post) {
    res.status(404).json({ message: "晒图不存在" });
    return;
  }
  post.comments = post.comments || [];
  post.comments.push({ userName: req.user.name, content: req.body.content, createdAt: localDate() });
  writeDb(db);
  res.status(201).json({ post: publicPost(post, req.user) });
});

app.use((req, res) => {
  res.status(404).json({ message: "接口不存在" });
});

app.listen(PORT, () => {
  console.log(`爱的 Express API listening on ${PORT}`);
});
