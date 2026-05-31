const fs = require("fs");
const path = require("path");

const UPLOAD_DIR = path.join(__dirname, "uploads");

function isCloudFileId(value) {
  return typeof value === "string" && value.startsWith("cloud://");
}

function publicImageUrl(imageUrl) {
  return imageUrl;
}

async function saveUploadedFile(file) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const ext = path.extname(file.originalname) || ".jpg";
  const filename = `${file.filename}${ext}`;
  fs.renameSync(file.path, path.join(UPLOAD_DIR, filename));
  return `/uploads/${filename}`;
}

async function saveCloudFileId(fileID) {
  if (!isCloudFileId(fileID)) {
    throw new Error("无效的云存储文件 ID");
  }
  return fileID;
}

module.exports = {
  publicImageUrl,
  saveCloudFileId,
  saveUploadedFile
};
