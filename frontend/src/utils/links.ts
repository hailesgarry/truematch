export type ParsedLink = {
  /** Normalized absolute URL (http/https). */
  url: string;
  /** Raw match from the source string (before sanitation). */
  raw: string;
  /** Substring used for anchor display (trailing punctuation removed). */
  display: string;
  /** Trailing punctuation removed from the raw match so it can be re-appended. */
  suffix: string;
  /** Start index of the raw match within the original text. */
  index: number;
  /** Raw match length (before suffix removal). */
  length: number;
};

const URL_REGEX = /https?:\/\/[^\s]+/gi;
const TRAILING_CHARS = [
  ")",
  "]",
  "}",
  ">",
  ",",
  ".",
  "!",
  "?",
  ";",
  ":",
  "'",
  '"',
];
const TRAILING_SET = new Set(TRAILING_CHARS);

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      !url.protocol ||
      (url.protocol !== "http:" && url.protocol !== "https:")
    ) {
      return null;
    }
    // Remove hash to reduce cache fragmentation, keep search params.
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function trimTrailingPunctuation(value: string): {
  cleaned: string;
  suffix: string;
} {
  let cleaned = value;
  let suffix = "";
  while (cleaned.length > 0) {
    const lastChar = cleaned[cleaned.length - 1];
    if (!TRAILING_SET.has(lastChar)) break;
    if (lastChar === ")") {
      const without = cleaned.slice(0, -1);
      const opens = (without.match(/\(/g) || []).length;
      const closes = (without.match(/\)/g) || []).length;
      if (opens > closes) {
        break;
      }
    }
    cleaned = cleaned.slice(0, -1);
    suffix = lastChar + suffix;
  }
  return { cleaned, suffix };
}

export function extractLinks(text: string): ParsedLink[] {
  if (!text) return [];
  const matches: ParsedLink[] = [];
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(text)) !== null) {
    const raw = match[0];
    const { cleaned, suffix } = trimTrailingPunctuation(raw);
    const normalized = normalizeUrl(cleaned);
    if (!normalized) continue;
    matches.push({
      url: normalized,
      raw,
      display: cleaned,
      suffix,
      index: match.index,
      length: raw.length,
    });
  }
  return matches;
}

export function firstLink(text: string): ParsedLink | undefined {
  const [link] = extractLinks(text);
  return link;
}

export function getHostFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

export function buildFaviconUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return null;
  }
}
