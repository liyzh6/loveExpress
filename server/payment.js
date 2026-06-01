const crypto = require("crypto");
const https = require("https");

function payAppId() {
  return process.env.WECHAT_PAY_APP_ID || process.env.WECHAT_APPID || "";
}

function normalizePem(value, type) {
  let pem = String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  const begin = `-----BEGIN ${type}-----`;
  const end = `-----END ${type}-----`;
  if (pem.includes(begin) && pem.includes(end)) {
    let body = pem
      .replace(begin, "")
      .replace(end, "")
      .replace(/\s+/g, "");
    body = body.replace(/[^A-Za-z0-9+/=]/g, "");
    pem = `${begin}\n${body.match(/.{1,64}/g).join("\n")}\n${end}`;
  }
  return pem;
}

function pemBody(value, type) {
  const pem = normalizePem(value, type);
  return pem
    .replace(`-----BEGIN ${type}-----`, "")
    .replace(`-----END ${type}-----`, "")
    .replace(/\s+/g, "");
}

function privateKey() {
  return normalizePem(process.env.WECHAT_PAY_PRIVATE_KEY, "PRIVATE KEY");
}

function platformPublicKey() {
  return normalizePem(process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY, "PUBLIC KEY");
}

function getConfigStatus() {
  const key = privateKey();
  const publicKey = platformPublicKey();
  const apiV3Key = String(process.env.WECHAT_PAY_API_V3_KEY || "");
  const required = {
    WECHAT_PAY_MCH_ID: process.env.WECHAT_PAY_MCH_ID,
    WECHAT_PAY_APP_ID: payAppId(),
    WECHAT_PAY_SERIAL_NO: process.env.WECHAT_PAY_SERIAL_NO,
    WECHAT_PAY_PRIVATE_KEY: key,
    WECHAT_PAY_NOTIFY_URL: process.env.WECHAT_PAY_NOTIFY_URL
  };
  const missing = Object.keys(required).filter((name) => !required[name]);
  const warnings = [];
  const privateKeyLooksPem = key.startsWith("-----BEGIN PRIVATE KEY-----") && key.endsWith("-----END PRIVATE KEY-----");
  const platformPublicKeyLooksPem = publicKey.startsWith("-----BEGIN PUBLIC KEY-----") && publicKey.endsWith("-----END PUBLIC KEY-----");
  const privateKeyBody = pemBody(process.env.WECHAT_PAY_PRIVATE_KEY, "PRIVATE KEY");

  if (key && !privateKeyLooksPem) warnings.push("WECHAT_PAY_PRIVATE_KEY 不是完整的商户 API 私钥 PEM");
  if (privateKeyBody && !/^[A-Za-z0-9+/=]+$/.test(privateKeyBody)) warnings.push("WECHAT_PAY_PRIVATE_KEY 正文包含非 base64 字符，请重新复制 apiclient_key.pem");
  if (process.env.NODE_ENV === "production" && !platformPublicKeyLooksPem) {
    warnings.push("生产环境建议配置完整的 WECHAT_PAY_PLATFORM_PUBLIC_KEY 用于回调验签");
  }
  if (apiV3Key && Buffer.byteLength(apiV3Key) !== 32) {
    warnings.push("WECHAT_PAY_API_V3_KEY 应为 32 字节");
  }
  if (process.env.WECHAT_PAY_NOTIFY_URL && !/^https:\/\//.test(process.env.WECHAT_PAY_NOTIFY_URL)) {
    warnings.push("WECHAT_PAY_NOTIFY_URL 必须是 HTTPS 地址");
  }

  return {
    configured: missing.length === 0 && privateKeyLooksPem,
    missing,
    warnings,
    appIdSource: process.env.WECHAT_PAY_APP_ID ? "WECHAT_PAY_APP_ID" : (process.env.WECHAT_APPID ? "WECHAT_APPID" : ""),
    checks: {
      privateKeyLooksPem,
      privateKeyLength: key.length,
      privateKeyBodyLength: privateKeyBody.length,
      privateKeyBodyBase64: !privateKeyBody || /^[A-Za-z0-9+/=]+$/.test(privateKeyBody),
      platformPublicKeyLooksPem,
      apiV3KeyByteLength: Buffer.byteLength(apiV3Key)
    }
  };
}

function verifyNotifySignature(headers, rawBody) {
  const publicKey = platformPublicKey();
  if (!publicKey.includes("BEGIN PUBLIC KEY")) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("未配置完整的微信支付平台公钥，无法验签");
    }
    return true;
  }
  const timestamp = headers["wechatpay-timestamp"];
  const nonce = headers["wechatpay-nonce"];
  const signature = headers["wechatpay-signature"];
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  return crypto.createVerify("RSA-SHA256").update(message).verify(publicKey, signature, "base64");
}

function randomString(size = 32) {
  return crypto.randomBytes(size).toString("hex").slice(0, size);
}

function sign(message) {
  try {
    return crypto.createSign("RSA-SHA256").update(message).sign(privateKey(), "base64");
  } catch (error) {
    throw new Error(`商户 API 私钥格式错误：${error.message}`);
  }
}

function requestWechatPay(method, apiPath, body) {
  const mchid = process.env.WECHAT_PAY_MCH_ID;
  const serialNo = process.env.WECHAT_PAY_SERIAL_NO;
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomString();
  const rawBody = body ? JSON.stringify(body) : "";
  const message = `${method}\n${apiPath}\n${timestamp}\n${nonce}\n${rawBody}\n`;
  const signature = sign(message);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.mch.weixin.qq.com",
      path: apiPath,
      method,
      headers: {
        "content-type": "application/json",
        Accept: "application/json",
        "User-Agent": "loveExpress/1.0",
        Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const data = text ? JSON.parse(text) : {};
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(data.message || data.code || "微信支付请求失败"));
        }
      });
    });
    req.on("error", reject);
    if (rawBody) req.write(rawBody);
    req.end();
  });
}

async function createJsapiPayment(order, openid) {
  const status = getConfigStatus();
  if (!status.configured) {
    return {
      configured: false,
      message: "微信支付未完成配置",
      missing: status.missing,
      warnings: status.warnings,
      checks: status.checks
    };
  }
  const appid = payAppId();
  if (!openid) throw new Error("用户未绑定微信 openid，无法发起 JSAPI 支付");
  const body = {
    appid,
    mchid: process.env.WECHAT_PAY_MCH_ID,
    description: `予花知爱-${order.id}`,
    out_trade_no: order.id,
    notify_url: process.env.WECHAT_PAY_NOTIFY_URL,
    amount: {
      total: Math.round((order.totalPrice || 0) * 100),
      currency: "CNY"
    },
    payer: { openid }
  };
  const result = await requestWechatPay("POST", "/v3/pay/transactions/jsapi", body);
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = randomString();
  const packageValue = `prepay_id=${result.prepay_id}`;
  const paySign = sign(`${appid}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`);
  return {
    configured: true,
    payment: {
      timeStamp,
      nonceStr,
      package: packageValue,
      signType: "RSA",
      paySign
    }
  };
}

async function requestRefund(order, reason) {
  const status = getConfigStatus();
  if (!status.configured) {
    return {
      configured: false,
      message: "微信退款未配置",
      missing: status.missing,
      warnings: status.warnings
    };
  }
  const body = {
    out_trade_no: order.id,
    out_refund_no: `R${Date.now()}`,
    reason,
    notify_url: process.env.WECHAT_REFUND_NOTIFY_URL,
    amount: {
      refund: Math.round((order.totalPrice || 0) * 100),
      total: Math.round((order.totalPrice || 0) * 100),
      currency: "CNY"
    }
  };
  return {
    configured: true,
    refund: await requestWechatPay("POST", "/v3/refund/domestic/refunds", body)
  };
}

function decryptNotifyResource(resource) {
  const apiV3Key = process.env.WECHAT_PAY_API_V3_KEY;
  if (!apiV3Key) throw new Error("未配置 WECHAT_PAY_API_V3_KEY");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(apiV3Key), Buffer.from(resource.nonce));
  decipher.setAuthTag(Buffer.from(resource.ciphertext, "base64").slice(-16));
  decipher.setAAD(Buffer.from(resource.associated_data || ""));
  const ciphertext = Buffer.from(resource.ciphertext, "base64").slice(0, -16);
  const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decoded.toString("utf8"));
}

async function createProfitSharing() {
  return {
    configured: false,
    message: "分账暂未实现，当前资金保持平台托管"
  };
}

module.exports = {
  createJsapiPayment,
  createProfitSharing,
  decryptNotifyResource,
  getConfigStatus,
  requestRefund,
  verifyNotifySignature
};
