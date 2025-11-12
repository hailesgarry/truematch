function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "*";
  if (!raw) return "*";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "*") return "*";
  const origins = trimmed
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origins.length === 0) return "*";
  if (origins.length === 1) return origins[0];
  return origins;
}

module.exports = {
  port: process.env.PORT || 8080,
  corsOrigins: parseCorsOrigins(),
  dataFolder: "data",
};
