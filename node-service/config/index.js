function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "*";
  if (!raw) return ["*"];
  const origins = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origins.length) return ["*"];
  if (origins.includes("*")) return ["*"];
  return origins;
}

module.exports = {
  port: process.env.PORT || 8080,
  corsOrigins: parseCorsOrigins(),
  dataFolder: "data",
};
