import { create } from "zustand";
import { persist } from "zustand/middleware";

type Proposal = {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: string; // ISO
  votes: Record<string, true>; // userId -> true
};

type RoomTopicState = {
  proposals: Proposal[];
  currentTopicId: string | null; // highest vote (computed, stored for convenience)
};

type TopicStore = {
  byGroup: Record<string, RoomTopicState>;
  submitProposal: (
    groupId: string,
    text: string,
    authorId: string,
    authorName: string
  ) => void;
  voteExclusive: (groupId: string, proposalId: string, userId: string) => void;
  unvote: (groupId: string, proposalId: string, userId: string) => void;
};

function genId() {
  return `t_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function recomputeWinner(state: RoomTopicState): string | null {
  if (!state.proposals.length) return null;
  let bestId: string | null = null;
  let bestVotes = -1;
  let bestCreated = ""; // tie-breaker: newest wins
  for (const p of state.proposals) {
    const count = Object.keys(p.votes || {}).length;
    if (count > bestVotes) {
      bestVotes = count;
      bestId = p.id;
      bestCreated = p.createdAt;
    } else if (count === bestVotes && bestVotes >= 0) {
      if (p.createdAt > bestCreated) {
        bestId = p.id;
        bestCreated = p.createdAt;
      }
    }
  }
  return bestId;
}

export const useTopicStore = create<TopicStore>()(
  persist(
    (set, _get) => {
      void _get;
      return {
        byGroup: {},
        submitProposal: (groupId, text, authorId, authorName) =>
          set((s) => {
            const entry: RoomTopicState = s.byGroup[groupId] || {
              proposals: [],
              currentTopicId: null,
            };
            const proposal: Proposal = {
              id: genId(),
              text: text.trim(),
              authorId,
              authorName,
              createdAt: new Date().toISOString(),
              votes: {},
            };
            const next: RoomTopicState = {
              ...entry,
              proposals: [...entry.proposals, proposal],
            };
            next.currentTopicId = recomputeWinner(next);
            return { byGroup: { ...s.byGroup, [groupId]: next } };
          }),
        voteExclusive: (groupId, proposalId, userId) =>
          set((s) => {
            const entry: RoomTopicState = s.byGroup[groupId] || {
              proposals: [],
              currentTopicId: null,
            };
            const proposals = entry.proposals.map((p) => {
              // remove user's vote from all proposals
              const nextVotes = { ...(p.votes || {}) };
              delete nextVotes[userId];
              // add vote only to the target
              if (p.id === proposalId) {
                nextVotes[userId] = true;
              }
              return { ...p, votes: nextVotes };
            });
            const next: RoomTopicState = { proposals, currentTopicId: null };
            next.currentTopicId = recomputeWinner(next);
            return { byGroup: { ...s.byGroup, [groupId]: next } };
          }),
        unvote: (groupId, proposalId, userId) =>
          set((s) => {
            const entry: RoomTopicState = s.byGroup[groupId] || {
              proposals: [],
              currentTopicId: null,
            };
            const proposals = entry.proposals.map((p) => {
              if (p.id !== proposalId) return p;
              const nextVotes = { ...(p.votes || {}) };
              delete nextVotes[userId];
              return { ...p, votes: nextVotes };
            });
            const next: RoomTopicState = { proposals, currentTopicId: null };
            next.currentTopicId = recomputeWinner(next);
            return { byGroup: { ...s.byGroup, [groupId]: next } };
          }),
      };
    },
    { name: "chat-room-topics", partialize: (s) => ({ byGroup: s.byGroup }) }
  )
);
