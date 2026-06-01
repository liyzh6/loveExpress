const crypto = require("crypto");
const https = require("https");

function payAppId() {
  return process.env.WECHAT_PAY_APP_ID || process.env.WECHAT_APPID || "";
}

function normalizePem(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function getConfigStatus() {
  const privateKey = normalizePem(process.env.WECHAT_PAY_PRIVATE_KEY);
  const platformPublicKey = normalizePem(process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY);
  const apiV3Key = String(process.env.WECHAT_PAY_API_V3_KEY || "");
  const required = {
    WECHAT_PAY_MCH_ID: process.env.WECHAT_PAY_MCH_ID,
    WECHAT_PAY_APP_ID: payAppId(),
    WECHAT_PAY_SERIAL_NO: process.env.WECHAT_PAY_SERIAL_NO,
    WECHAT_PAY_PRIVATE_KEY: privateKey,
    WECHAT_PAY_NOTIFY_URL: process.env.WECHAT_PAY_NOTIFY_URL
  };
  const missing = Object.keys(required).filter((key) => !required[key]);
  const warnings = [];
  if (privateKey && !privateKey.includes("BEGIN PRIVATE KEY")) {
    warnings.push("WECHAT_PAY_PRIVATE_KEY 看起来不是完整的商户 API 私钥 PEM");
  }
  if (process.env.NODE_ENV === "production" && !platformPublicKey.includes("BEGIN PUBLIC KEY")) {
    warnings.push("生产环境建议配置完整的 WECHAT_PAY_PLATFORM_PUBLIC_KEY 用于回调验签");
  }
  if (apiV3Key && Buffer.byteLength(apiV3Key) !== 32) {
    warnings.push("WECHAT_PAY_API_V3_KEY 应为 32 字节，当前长度不符合微信支付回调解密要求");
  }
  if (process.env.WECHAT_PAY_NOTIFY_URL && !/^https:\/\//.test(process.env.WECHAT_PAY_NOTIFY_URL)) {
    warnings.push("WECHAT_PAY_NOTIFY_URL 必须是 HTTPS 地址");
  }
  return {
    configured: missing.length === 0 && privateKey.includes("BEGIN PRIVATE KEY"),
    missing,
    warnings,
    appIdSource: process.env.WECHAT_PAY_APP_ID ? "WECHAT_PAY_APP_ID" : (process.env.WECHAT_APPID ? "WECHAT_APPID" : "")
  };
}

function configured() {
  return getConfigStatus().configured;
}

function verifyNotifySignature(headers, rawBody) {
  const publicKey = normalizePem(process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY);
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
  return crypto.createVerify("RSA-SHA256")
    .update(message)
    .verify(publicKey, signature, "base64");
}

function randomString(size = 32) {
  return crypto.randomBytes(size).toString("hex").slice(0, size);
}

function getPrivateKey() {
  return normalizePem(process.env.WECHAT_PAY_PRIVATE_KEY);
}

function sign(message) {
  return crypto.createSign("RSA-SHA256").update(message).sign(getPrivateKey(), "base64");
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
      warnings: status.warnings
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
