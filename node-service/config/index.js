function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? "";
  const origins = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return origins;
}

module.exports = {
  port: process.env.PORT || 8080,
  corsOrigins: parseCorsOrigins(),
  dataFolder: "data",
};
