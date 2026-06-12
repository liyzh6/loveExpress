const fs = require("fs");
const path = require("path");

const DEFAULT_ENV_FILE = path.resolve(__dirname, "..", "环境变量.json");

function parseLooseEnvObject(text) {
  const values = {};
  let index = 0;

  function skipSpaceAndComma() {
    while (index < text.length && /[\s,{,]/.test(text[index])) index += 1;
  }

  function readQuoted() {
    if (text[index] !== "\"") return "";
    index += 1;
    let value = "";
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") {
        const next = text[index + 1];
        if (next === "n") value += "\n";
        else if (next === "r") value += "\r";
        else if (next === "t") value += "\t";
        else if (next === "\"" || next === "\\" || next === "/") value += next;
        else value += next || "";
        index += 2;
        continue;
      }
      if (char === "\"") {
        index += 1;
        return value;
      }
      value += char;
      index += 1;
    }
    return value;
  }

  while (index < text.length) {
    skipSpaceAndComma();
    if (text[index] === "}") break;
    const key = readQuoted();
    skipSpaceAndComma();
    if (text[index] !== ":") {
      index += 1;
      continue;
    }
    index += 1;
    skipSpaceAndComma();
    const value = readQuoted();
    if (key) values[key] = value;
  }

  return values;
}

function loadLocalEnvFile(filePath = process.env.LOCAL_ENV_FILE || DEFAULT_ENV_FILE) {
  if (process.env.DISABLE_LOCAL_ENV_FILE === "1") return { loaded: false, reason: "disabled" };
  if (!fs.existsSync(filePath)) return { loaded: false, reason: "not_found" };

  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = parseLooseEnvObject(raw);
  const loadedKeys = [];

  Object.keys(parsed).forEach((key) => {
    if (key.startsWith("MYSQL_") && process.env.LOAD_LOCAL_MYSQL !== "1") return;
    if (process.env[key]) return;
    process.env[key] = parsed[key];
    loadedKeys.push(key);
  });

  return { loaded: true, filePath, loadedKeys };
}

module.exports = {
  loadLocalEnvFile,
  parseLooseEnvObject
};
