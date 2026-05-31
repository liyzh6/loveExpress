const https = require("https");

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(data);
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

async function verifyLoginCode(code) {
  if (!code) {
    throw new Error("缺少微信登录凭证");
  }
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_SECRET;
  if (!appid || !secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("服务端未配置 WECHAT_APPID 或 WECHAT_SECRET");
    }
    return {
      openid: `dev-openid-${code}`,
      session_key: "dev-session-key"
    };
  }
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const data = await requestJson(url);
  if (data.errcode) {
    throw new Error(data.errmsg || "微信账号校验失败");
  }
  return data;
}

module.exports = {
  verifyLoginCode
};
