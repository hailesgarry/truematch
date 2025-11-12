import { customAlphabet } from "nanoid";

// Lowercase letters and digits only to keep slug-friendly ids
const lowerAlphaNum = "abcdefghijklmnopqrstuvwxyz0123456789";
const nanoLower = customAlphabet(lowerAlphaNum);

export function toSlug(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateId(length = 10, prefix = ""): string {
  const rand = nanoLower(Math.max(4, Math.min(64, length)));
  return prefix ? `${prefix}${prefix.endsWith("-") ? "" : "-"}${rand}` : rand;
}

export function generateUniqueId(
  existing: Iterable<string>,
  length = 10,
  prefix = ""
): string {
  const set = new Set(existing);
  for (let i = 0; i < 50; i++) {
    const id = generateId(length, prefix);
    if (!set.has(id)) return id;
  }
  // Last resort, append a short suffix
  const fallback = generateId(Math.max(6, Math.floor(length / 2)));
  let base = generateId(length, prefix);
  if (set.has(base)) base = `${base}-${fallback}`;
  return base;
}
