export interface User {
  userId?: string;
  username: string;
  avatar?: string | null;
  bubbleColor?: string;
}

export interface Group {
  id: string;
  name: string;
  avatarUrl?: string | null;
  description: string;
  onlineCount?: number;
  databaseId?: string;
  slug?: string;
  memberCount?: number | null;
  memberPreview?: Array<{
    username: string;
    avatar?: string | null;
    userId?: string | null;
  }>;
  lastMessageAt?: number | null;
  lastActiveAt?: number | null;
  lastMessagePreview?: {
    username?: string;
    text?: string;
    previewText?: string;
    voiceNote?: boolean;
    kind?: string | null;
    createdAt?: number | null;
    hasMedia?: boolean;
    mediaType?: "photo" | "video" | "attachment" | null;
    audioDurationMs?: number | null;
  } | null;
  summaryFetchedAt?: number;
  thumbnail?: string | null;
}

export interface MessageMedia {
  original: string;
  gif?: string;
  mp4?: string;
  webm?: string;
  preview?: string;
  placeholder?: string;
  width?: number;
  height?: number;
  type?: string;
  uploading?: boolean;
}

export type MessageAudio = {
  url: string;
  durationMs?: number;
  uploading?: boolean;
};

export type Message = {
  messageId?: string;
  userId?: string;
  username: string;
  avatar?: string | null;
  bubbleColor?: string;
  text: string;
  timestamp: string;
  replyTo?: {
    messageId?: string;
    username: string;
    text: string;
    timestamp?: string | null;
    // Optional structured info for previews
    kind?: "text" | "gif" | "media" | "audio";
    media?: MessageMedia;
    audio?: MessageAudio;
    deleted?: boolean;
    deletedAt?: string;
  };
  edits?: {
    previousText: string;
    editedAt: string;
  }[];
  lastEditedAt?: string;
  edited?: boolean;
  deleted?: boolean;
  deletedAt?: string;

  // Structured / media
  kind?: "text" | "gif" | "media" | "audio";
  media?: MessageMedia;

  audio?: MessageAudio;

  system?: boolean;
  systemType?: "join" | "leave" | "info" | "notice";

  // NEW: reactions keyed by userId
  reactions?: Record<string, UserReaction>;

  replySummary?: {
    count: number;
    samples: MessageReplySummary[];
    fetchedAt?: number;
  };
};

export type MessageReplySummary = {
  messageId: string;
  createdAt?: number | null;
  username?: string | null;
  kind?: string | null;
  text?: string | null;
  media?: MessageMedia | null;
  audio?: MessageAudio | null;
  deleted?: boolean | null;
};

// NEW reaction types
export type ReactionEmoji = string;

export interface UserReaction {
  emoji: ReactionEmoji;
  at: number; // ms since epoch
  userId: string; // who reacted
  username: string; // display name (may drift if user renames)
}

export type ToastTone = "success" | "error" | "neutral";
export interface Toast {
  message: string;
  visible: boolean;
  tone?: ToastTone;
}

// NEW/UPDATED: Dating profile
export interface DatingProfile {
  userId: string;
  username?: string;
  hasDatingProfile?: boolean;

  // Primary (legacy)
  photoUrl?: string | null;
  primaryPhotoUrl?: string | null;
  profileAvatarUrl?: string | null;
  photo?: string | null;

  // Basic profile
  mood?: string;
  age?: number;
  religion?: string;
  gender?: string; // NEW
  height?: string | null;
  bodyType?: string | null;
  displayName?: string;
  firstName?: string | null;
  interestedIn?: string;

  // Multiple photos + preferences
  photos?: string[];
  photoPlacements?: Record<string, string> | null;
  preferences?: {
    age?: { min: number; max: number };
    religions?: string[];
    partnerDescription?: string;
    lookingForInPartner?: string;
  };

  relationshipLookingFor?: string[];
  relationshipPreference?: string[];
  relationshipsLookingFor?: string[];
  smoking?: string | null;
  drinking?: string | null;
  children?: string | null;
  childrenCount?: number | null;
  relocation?: string | null;
  nationality?: string | null;
  about?: string | null;
  bio?: string | null;
  summary?: string | null;
  description?: string | null;
  partnerLookingFor?: string | null;
  lookingForInPartner?: string | null;
  partnerDescription?: string | null;
  favoriteMovie?: string | null;
  favoriteMusic?: string | null;
  musicPreference?: string | null;
  musicPreferences?: string | null;
  favoriteFood?: string | null;
  foodPreference?: string | null;
  foodPreferences?: string | null;
  perfectMatchDescription?: string | null;
  perfectMatch?: string | null;
  idealPartner?: string | null;
  hobby?: string | null;
  hobbies?: string | null;
  favoriteHobby?: string | null;
  weekendActivity?: string | null;
  weekendActivities?: string | null;
  typicalWeekend?: string | null;
  travelDestination?: string | null;
  dreamDestination?: string | null;
  favoriteDestination?: string | null;
  fitnessActivity?: string | null;
  workout?: string | null;
  exercise?: string | null;

  // BACKGROUND section fields
  education?: string | null;
  educationLevel?: string | null;
  school?: string | null;
  jobTitle?: string | null;
  occupation?: string | null;
  job?: string | null;
  company?: string | null;
  workplace?: string | null;
  employer?: string | null;
  lifePhilosophy?: string | null;
  philosophy?: string | null;
  outlook?: string | null;
  communicationStyle?: string | null;
  communicationPreference?: string | null;
  howToCommunicate?: string | null;

  // ANSWER QUESTIONS section fields
  datingProCon?: string | null;
  prosAndCons?: string | null;
  prosConsOfDatingMe?: string | null;
  loveLanguage?: string | null;
  myLoveLanguage?: string | null;
  loveLanguages?: string | null;
  firstDate?: string | null;
  idealFirstDate?: string | null;
  perfectFirstDate?: string | null;
  greenFlag?: string | null;
  greenFlags?: string | null;
  myGreenFlag?: string | null;
  redFlag?: string | null;
  redFlags?: string | null;
  dealBreaker?: string | null;
  seekingFor?: string | null;
  seeking?: string | null;
  lookingForRelationship?: string | null;
  selfCare?: string | null;
  selfCareIs?: string | null;
  mySelfCare?: string | null;
  simplePleasures?: string | null;
  mySimplePleasures?: string | null;
  simplePleasure?: string | null;
  greatRelationship?: string | null;
  relationshipGreat?: string | null;
  whatMakesRelationshipGreat?: string | null;

  location?: GeoLocation | null;
  createdAt?: number | string;
  updatedAt?: number | string;
  datingProfileCreatedAt?: number | string | null;
  matchPercentage?: number | null;
  matchBreakdown?: MatchBreakdown | null;
}

// NEW: precise-but-privacy-friendly location
export type GeoLocation = {
  lat?: number; // precise, stored for accuracy
  lon?: number; // precise, stored for accuracy
  accuracy?: number; // meters from Geolocation API
  city?: string; // derived via reverse-geocoding or manual
  state?: string; // derived via reverse-geocoding or manual
  stateCode?: string; // ISO / dataset identifier when available
  country?: string; // ISO-2 if available
  countryCode?: string; // explicit ISO-2 code when supplied
  formatted?: string; // e.g., "Alace, Lagos" or "City, State"
};

export type MatchBreakdownComponent = {
  score: number;
  weight: number;
  [key: string]: number | string | string[] | boolean | null | undefined;
};

export interface MatchBreakdown {
  total: number;
  rawTotal?: number;
  components: {
    location: MatchBreakdownComponent;
    relationship: MatchBreakdownComponent;
    interests: MatchBreakdownComponent;
    lifestyle: MatchBreakdownComponent;
    personality: MatchBreakdownComponent;
    [key: string]: MatchBreakdownComponent;
  };
}

// Use for upsert calls where userId is required but other fields are optional
export type DatingProfileUpsert = {
  userId: string;
} & Partial<
  Omit<
    DatingProfile,
    | "userId"
    | "matchBreakdown"
    | "matchPercentage"
    | "hasDatingProfile"
    | "createdAt"
    | "updatedAt"
    | "datingProfileCreatedAt"
  >
>;
