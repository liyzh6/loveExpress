const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const mysql = require("mysql2/promise");

const DATA_FILE = path.join(__dirname, "data", "db.json");
const STATE_ID = 1;

let mysqlPool = null;
let memoryDb = null;
let flushTimer = null;

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

function defaultDb() {
  return {
    users: [],
    orders: [],
    posts: [],
    comments: [],
    refundRequests: [],
    disputes: [],
    operationLogs: []
  };
}

function normalizeDb(db) {
  const next = db && typeof db === "object" ? db : defaultDb();
  next.users = next.users || [];
  next.orders = next.orders || [];
  next.posts = next.posts || [];
  next.comments = next.comments || [];
  next.refundRequests = next.refundRequests || [];
  next.disputes = next.disputes || [];
  next.operationLogs = next.operationLogs || [];
  return next;
}

function ensureDbFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDb(), null, 2));
  }
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
  return changed;
}

function readJsonFileDb() {
  ensureDbFile();
  const db = normalizeDb(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  if (seedSystemAccounts(db)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  }
  return db;
}

function mysqlConfigured() {
  return Boolean(process.env.MYSQL_ADDRESS && process.env.MYSQL_USERNAME && process.env.MYSQL_PASSWORD);
}

function parseMysqlAddress(address) {
  const [host, port = "3306"] = String(address || "").split(":");
  return { host, port: Number(port) || 3306 };
}

function mysqlDatabaseName() {
  return process.env.MYSQL_DATABASE || process.env.MYSQL_DB || "love_express";
}

async function initializeMysql() {
  const address = parseMysqlAddress(process.env.MYSQL_ADDRESS);
  const database = mysqlDatabaseName();
  const baseConfig = {
    host: address.host,
    port: address.port,
    user: process.env.MYSQL_USERNAME,
    password: process.env.MYSQL_PASSWORD,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 5),
    charset: "utf8mb4"
  };

  const bootstrap = await mysql.createConnection(baseConfig);
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrap.end();

  mysqlPool = mysql.createPool(Object.assign({}, baseConfig, { database }));
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INT PRIMARY KEY,
      data JSON NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [rows] = await mysqlPool.query("SELECT data FROM app_state WHERE id = ?", [STATE_ID]);
  if (rows.length > 0) {
    memoryDb = normalizeDb(typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data);
  } else {
    memoryDb = defaultDb();
    await mysqlPool.query("INSERT INTO app_state (id, data) VALUES (?, CAST(? AS JSON))", [
      STATE_ID,
      JSON.stringify(memoryDb)
    ]);
  }

  if (seedSystemAccounts(memoryDb)) {
    await flushMysql();
  }
  console.log(`MySQL storage enabled: ${address.host}:${address.port}/${database}`);
}

async function initialize() {
  if (!mysqlConfigured()) {
    memoryDb = null;
    readJsonFileDb();
    console.log("JSON file storage enabled");
    return;
  }
  try {
    await initializeMysql();
  } catch (error) {
    console.error("MySQL initialization failed:", error.message);
    throw error;
  }
}

async function flushMysql() {
  if (!mysqlPool || !memoryDb) return;
  await mysqlPool.query(
    "INSERT INTO app_state (id, data) VALUES (?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE data = VALUES(data)",
    [STATE_ID, JSON.stringify(memoryDb)]
  );
}

function scheduleMysqlFlush() {
  if (!mysqlPool) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushMysql().catch((error) => {
      console.error("MySQL state flush failed:", error.message);
    });
  }, Number(process.env.MYSQL_FLUSH_DELAY_MS || 100));
}

function writeDb(db) {
  if (mysqlPool) {
    memoryDb = normalizeDb(db);
    scheduleMysqlFlush();
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function readDb() {
  if (mysqlPool) {
    return normalizeDb(memoryDb || defaultDb());
  }
  return readJsonFileDb();
}

function withDb(mutator) {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}

function storageMode() {
  return mysqlPool ? "mysql" : "json";
}

module.exports = {
  createUser,
  hashPassword,
  initialize,
  localDate,
  publicUser,
  readDb,
  storageMode,
  withDb,
  writeDb
};
