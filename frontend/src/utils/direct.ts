export function directRoomIdFor(a: string, b: string): string {
  const [u1, u2] = [a, b].map((s) => s.trim().toLowerCase());
  return `dm:${[u1, u2].sort().join("|")}`;
}

// Returns the "other" username from a dmId like "dm:alice|bob" given the current user.
// Falls back to the lowercased value if casing can't be inferred from messages.
export function peerFromDmId(dmId: string, me: string): string {
  const lcMe = (me || "").trim().toLowerCase();
  const m = /^dm:(.+)\|(.+)$/.exec(dmId);
  if (!m) return "";
  const [a, b] = [m[1], m[2]];
  const other = a === lcMe ? b : b === lcMe ? a : a; // if me doesn't match, pick first
  return other;
}
