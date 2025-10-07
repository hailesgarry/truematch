export interface User {
  userId?: string;
  username: string;
  avatar?: string | null;
  bubbleColor?: string;
}

export interface Group {
  id: string;
  name: string;
  avatarUrl?: string;
  description: string;
  onlineCount?: number;
}

export interface MessageMedia {
  original: string;
  gif?: string;
  mp4?: string;
  webm?: string;
  preview?: string;
  width?: number;
  height?: number;
}

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
  kind?: "text" | "gif" | "media";
  media?: MessageMedia;

  system?: boolean;
  systemType?: "join" | "leave" | "info" | "notice";

  // NEW: reactions keyed by userId
  reactions?: Record<string, UserReaction>;
};

// NEW reaction types
export type ReactionEmoji = string;

export interface UserReaction {
  emoji: ReactionEmoji;
  at: number; // ms since epoch
  userId: string; // who reacted
  username: string; // display name (may drift if user renames)
}

export interface Toast {
  message: string;
  visible: boolean;
}

// NEW/UPDATED: Dating profile
export interface DatingProfile {
  username: string;

  // Primary (legacy)
  photoUrl?: string | null;
  photo?: string | null;

  // Basic profile
  mood?: string;
  age?: number;
  religion?: string;
  gender?: string; // NEW

  // Multiple photos + preferences
  photos?: string[];
  preferences?: {
    age?: { min: number; max: number };
    religions?: string[];
  };

  location?: GeoLocation | null;
  updatedAt?: number | string;
}

// NEW: precise-but-privacy-friendly location
export type GeoLocation = {
  lat: number; // precise, stored for accuracy
  lon: number; // precise, stored for accuracy
  accuracy?: number; // meters from Geolocation API
  city?: string; // derived via reverse-geocoding or manual
  state?: string; // derived via reverse-geocoding or manual
  country?: string; // ISO-2 if available
  formatted?: string; // e.g., "Alace, Lagos" or "City, State"
};
