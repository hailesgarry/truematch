import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SocialType = "facebook" | "twitter" | "tiktok";

export type LinkedAccount = {
  id: string;
  type: SocialType;
  url: string;
};

type State = {
  links: LinkedAccount[];
  addLink: (link: LinkedAccount) => void;
  updateLink: (id: string, patch: Partial<LinkedAccount>) => void;
  removeLink: (id: string) => void;
  setLinks: (links: LinkedAccount[]) => void;
  hasType: (type: SocialType) => boolean;
  findByType: (type: SocialType) => LinkedAccount | undefined;
  upsertByType: (type: SocialType, url: string) => void;
};

export const useProfileLinksStore = create<State>()(
  persist(
    (set, get) => ({
      links: [],
      addLink: (link) => set((s) => ({ links: [...s.links, link] })),
      updateLink: (id, patch) =>
        set((s) => ({
          links: s.links.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        })),
      removeLink: (id) =>
        set((s) => ({ links: s.links.filter((l) => l.id !== id) })),
      setLinks: (links) => set({ links }),
      hasType: (type) => get().links.some((l) => l.type === type),
      findByType: (type) => get().links.find((l) => l.type === type),
      upsertByType: (type, url) => {
        const existing = get().links.find((l) => l.type === type);
        if (existing) {
          get().updateLink(existing.id, { url });
        } else {
          const id = Math.random().toString(36).slice(2, 10);
          get().addLink({ id, type, url });
        }
      },
    }),
    { name: "profile-links", version: 1 }
  )
);
