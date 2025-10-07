const cloudinary = require("cloudinary").v2;

let configured = false;

function isEnabled() {
  if (process.env.CLOUDINARY_URL) return true;
  return (
    !!process.env.CLOUDINARY_CLOUD_NAME &&
    !!process.env.CLOUDINARY_API_KEY &&
    !!process.env.CLOUDINARY_API_SECRET
  );
}

function ensureConfigured() {
  if (configured) return cloudinary;
  if (!isEnabled()) return null;
  if (process.env.CLOUDINARY_URL) {
    // If CLOUDINARY_URL is set, Cloudinary SDK reads it automatically.
    // Apply secure URLs across the board.
    cloudinary.config({ secure: true });
  } else {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }
  configured = true;
  return cloudinary;
}

async function uploadDataUrl(
  dataUrl,
  { folder, resourceType = "auto", publicId } = {}
) {
  const cld = ensureConfigured();
  if (!cld) throw new Error("Cloudinary is not configured");
  const opts = { resource_type: resourceType };
  if (folder) opts.folder = folder;
  if (publicId) opts.public_id = publicId;
  // unique filename by default; do not overwrite existing
  opts.unique_filename = true;
  opts.overwrite = false;
  const res = await cld.uploader.upload(dataUrl, opts);
  return res.secure_url || res.url;
}

module.exports = { isEnabled, ensureConfigured, uploadDataUrl };

// Extra: surface current status for health checks
module.exports.getStatus = function getStatus() {
  return {
    configured: !!ensureConfigured(),
    usingUrl: !!process.env.CLOUDINARY_URL,
    cloudName:
      process.env.CLOUDINARY_CLOUD_NAME ||
      (process.env.CLOUDINARY_URL
        ? (process.env.CLOUDINARY_URL.split("@")[1] || "").split("/")[0]
        : undefined),
  };
};
