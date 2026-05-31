const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data", "db.json");

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

function ensureDb() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      users: [],
      orders: [],
      posts: [],
      comments: [],
      refundRequests: [],
      disputes: [],
      operationLogs: []
    }, null, 2));
  }
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
  if (changed) writeDb(db);
}

function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  db.users = db.users || [];
  db.orders = db.orders || [];
  db.posts = db.posts || [];
  db.comments = db.comments || [];
  db.refundRequests = db.refundRequests || [];
  db.disputes = db.disputes || [];
  db.operationLogs = db.operationLogs || [];
  seedSystemAccounts(db);
  return db;
}

function withDb(mutator) {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}

module.exports = {
  createUser,
  hashPassword,
  localDate,
  publicUser,
  readDb,
  withDb,
  writeDb
};
