import { create } from "zustand";
import { persist } from "zustand/middleware";

type BioState = {
  biosByUserId: Record<string, string>;
  getBio: (userId?: string | null) => string;
  setBio: (userId: string, bio: string) => void;
};

export const useProfileBioStore = create<BioState>()(
  persist(
    (set, get) => ({
      biosByUserId: {},
      getBio: (userId) => {
        if (!userId) return "";
        return get().biosByUserId[userId] || "";
      },
      setBio: (userId, bio) =>
        set((s) => ({ biosByUserId: { ...s.biosByUserId, [userId]: bio } })),
    }),
    { name: "profile-bios", version: 1 }
  )
);
