export const RELATIONSHIP_OPTIONS = [
  "New friends",
  "Something casual",
  "Long-term partner",
  "Life partner",
  "Still figuring it out",
] as const;

type RelationshipOption = (typeof RELATIONSHIP_OPTIONS)[number];

export const normalizeRelationship = (
  value: string | null | undefined
): RelationshipOption | string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();

  // New values
  if (
    lower.includes("new friend") ||
    lower.includes("friendship") ||
    lower === "friends"
  )
    return "New friends";
  if (lower.includes("casual") || lower.includes("something casual"))
    return "Something casual";
  if (
    lower.includes("long-term partner") ||
    lower.includes("long term partner")
  )
    return "Long-term partner";
  if (
    lower.includes("life partner") ||
    lower.includes("marriage") ||
    lower.includes("settle down")
  )
    return "Life partner";
  if (
    lower.includes("figuring") ||
    lower.includes("not sure") ||
    lower.includes("open to seeing")
  )
    return "Still figuring it out";

  // Legacy values mapping
  if (lower.includes("romance") || lower.includes("dating"))
    return "Something casual";
  if (
    lower.includes("long term relationship") ||
    lower.includes("serious relationship")
  )
    return "Long-term partner";

  const exact = RELATIONSHIP_OPTIONS.find(
    (option) => option.toLowerCase() === lower
  );
  return exact || trimmed;
};

export const sortRelationshipOptions = (values: string[]): string[] => {
  const result: string[] = [];
  const pushUnique = (value: string) => {
    if (
      !result.some((existing) => existing.toLowerCase() === value.toLowerCase())
    ) {
      result.push(value);
    }
  };

  RELATIONSHIP_OPTIONS.forEach((option) => {
    if (values.some((value) => value.toLowerCase() === option.toLowerCase())) {
      pushUnique(option);
    }
  });

  values.forEach(pushUnique);
  return result;
};

export const toCanonicalRelationshipList = (
  input?: string[] | null
): string[] => {
  const normalized = (input || [])
    .map((value) => normalizeRelationship(value))
    .filter((value): value is string => Boolean(value));
  const unique: string[] = [];
  normalized.forEach((value) => {
    if (
      !unique.some((existing) => existing.toLowerCase() === value.toLowerCase())
    ) {
      unique.push(value);
    }
  });
  return sortRelationshipOptions(unique);
};
