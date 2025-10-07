import { create } from "zustand";
import { persist } from "zustand/middleware";

type DatingProfile = {
  photo?: string | null; // data URL or remote URL
  mood?: string;
  // Optional extra fields for read-only convenience
  age?: number;
  religion?: string;
  gender?: string;
};

type DatingState = {
  profile: DatingProfile;
  setPhoto: (photo: string | null) => void;
  setMood: (mood: string) => void;
  reset: () => void;
};

export const useDatingStore = create<DatingState>()(
  persist(
    (set) => ({
      profile: { photo: null, mood: "" },
      setPhoto: (photo) => set((s) => ({ profile: { ...s.profile, photo } })),
      setMood: (mood) => set((s) => ({ profile: { ...s.profile, mood } })),
      reset: () => set({ profile: { photo: null, mood: "" } }),
    }),
    {
      name: "dating-profile",
      version: 1,
      partialize: (s) => ({ profile: s.profile }),
    }
  )
);
