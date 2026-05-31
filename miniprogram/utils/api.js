const app = getApp();

function request(options) {
  if (app.globalData.useCloudContainer && wx.cloud && wx.cloud.callContainer) {
    return new Promise((resolve, reject) => {
      wx.cloud.callContainer({
        config: {
          env: app.globalData.cloudEnv
        },
        path: options.url,
        method: options.method || "GET",
        data: options.data || {},
        header: Object.assign({
          "content-type": "application/json",
          "X-WX-SERVICE": app.globalData.cloudService,
          Authorization: app.globalData.token ? `Bearer ${app.globalData.token}` : ""
        }, options.header || {}),
        success(res) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
            return;
          }
          const message = res.data && res.data.message ? res.data.message : "请求失败";
          reject(new Error(message));
        },
        fail(error) {
          reject(error);
        }
      });
    });
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app.globalData.apiBaseUrl}${options.url}`,
      method: options.method || "GET",
      data: options.data || {},
      header: Object.assign({
        "content-type": "application/json",
        Authorization: app.globalData.token ? `Bearer ${app.globalData.token}` : ""
      }, options.header || {}),
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const message = res.data && res.data.message ? res.data.message : "请求失败";
        reject(new Error(message));
      },
      fail(error) {
        reject(error);
      }
    });
  });
}

function uploadPost(data) {
  if (app.globalData.useCloudContainer) {
    return Promise.reject(new Error("云托管内网调用暂不支持直接 multipart 上传，请先使用公网 uploadFile 域名或改为云存储上传。"));
  }

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${app.globalData.apiBaseUrl}/api/posts`,
      filePath: data.filePath,
      name: "image",
      formData: {
        orderId: data.orderId,
        title: data.title,
        content: data.content
      },
      header: {
        Authorization: app.globalData.token ? `Bearer ${app.globalData.token}` : ""
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(res.data));
          return;
        }
        reject(new Error("上传失败"));
      },
      fail(error) {
        reject(error);
      }
    });
  });
}

function requireRole(role) {
  const user = app.globalData.user || wx.getStorageSync("user");
  if (!app.globalData.token || !user || user.role !== role) {
    wx.showToast({ title: "请先登录对应账号", icon: "none" });
    setTimeout(() => {
      wx.reLaunch({ url: "/pages/login/login" });
    }, 500);
    return false;
  }
  return true;
}

module.exports = {
  request,
  uploadPost,
  requireRole
};
