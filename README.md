# 花束半定制微信小程序

这是一个微信小程序 + Node.js 后端的花束定制平台雏形，包含用户端、店家端、平台端、订单接口、图片上传、角色权限和社区审核流程。后端基于微信云托管 `wxcloudrun-express` 模板二次开发。

## 运行方式

1. 进入后端目录并安装依赖：

```bash
cd server
npm install
```

2. 启动后端：

```bash
npm start
```

3. 打开微信开发者工具。
4. 选择“导入项目”。
5. 项目目录选择当前文件夹：`C:\Users\liyiz\Documents\爱的express`。
6. AppID 可选择测试号，或继续使用 `touristappid`。
7. 编译运行。

小程序当前接口地址在 [app.js](</C:/Users/liyiz/Documents/爱的express/miniprogram/app.js>) 中配置为你的微信云托管域名：

```js
apiBaseUrl: "https://express-ydos-264225-8-1438597910.sh.run.tcloudbase.com"
```

## 已实现功能

- 登录页：用户账号注册、账号密码登录，店家和平台从底部入口登录，后端签发 token。
- 用户端：微信账号校验注册、自动填充上次登录账号密码、半定制花束、自动生成默认寄语、填写配送地址、提交订单、确认收货、上传晒图、浏览社区。
- 店家端：查看订单、预览效果、配送地址、配送时间、寄语和制作要求，按顺序更新订单状态。
- 平台端：查看全部订单、订单流水、平台抽佣，审核用户上传的社区晒图。
- 社区：平台审核通过后展示晒图内容，用户可点赞、取消点赞和评论。
- 交易：预留微信支付 JSAPI 下单、支付回调验签、退款售后、争议仲裁、自动确认收货、商户结算/分账对接点。
- 素材：已生成全部半定制组合花束图，位于 `server/public/bouquets/`，小程序通过云托管 HTTPS 地址远程加载，避免主包超过 2MB。

## 后端说明

后端部署目录为 [server](</C:/Users/liyiz/Documents/爱的express/server>)，结构遵循微信云托管 Express 模板：`index.js`、`package.json`、`Dockerfile`、`container.config.json`。

- 数据文件：[db.json](</C:/Users/liyiz/Documents/爱的express/server/data/db.json>)
- 数据库模块：[db.js](</C:/Users/liyiz/Documents/爱的express/server/db.js>)
- MySQL 初始化脚本：[schema.sql](</C:/Users/liyiz/Documents/爱的express/server/schema.sql>)
- 上传图片：[uploads](</C:/Users/liyiz/Documents/爱的express/server/uploads>)
- 云托管地址：`https://express-ydos-264225-8-1438597910.sh.run.tcloudbase.com`

预置账号：

- 用户：`user001` / `123456`
- 店家：`merchant001` / `123456`
- 平台：`admin001` / `123456`

## 云托管上传目录

后端更新时只上传 `server/` 目录内容到云托管或对应 GitHub 仓库。不要上传 `miniprogram/`、`node_modules/`、`.git/`、压缩包等无关文件。

## 后端环境变量

微信账号校验：

```text
WECHAT_APPID
WECHAT_SECRET
```

微信支付：

```text
WECHAT_PAY_APP_ID
WECHAT_PAY_MCH_ID
WECHAT_PAY_SERIAL_NO
WECHAT_PAY_PRIVATE_KEY
WECHAT_PAY_API_V3_KEY
WECHAT_PAY_PLATFORM_PUBLIC_KEY
WECHAT_PAY_NOTIFY_URL
WECHAT_REFUND_NOTIFY_URL
```

订单规则：

```text
AUTO_CONFIRM_HOURS=72
```

## 花束图生成

如需重新生成全部组合图：

```bash
node tools/generate-bouquet-images.js
```

当前组合数量为：送花场景 4 × 主花 4 × 色系 4 × 版型 3 × 包装 4 = 768 张。

## 待补充

- 微信支付 JSAPI。
- 微信 `wx.login` 与真实用户体系绑定。
- 数据库替换本地 JSON 文件。
- 花材库存。
- 图片合成或 Canvas 导出。
- 内容安全审核和风控。
- 订阅消息和售后流程。
