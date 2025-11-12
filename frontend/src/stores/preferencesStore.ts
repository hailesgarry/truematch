import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DistanceUnit = "metric" | "imperial";

interface PreferencesState {
  distanceUnit: DistanceUnit;
  setDistanceUnit: (unit: DistanceUnit) => void;
  toggleDistanceUnit: () => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set, get) => ({
      distanceUnit: "metric",
      setDistanceUnit: (unit) => set({ distanceUnit: unit }),
      toggleDistanceUnit: () =>
        set({
          distanceUnit: get().distanceUnit === "metric" ? "imperial" : "metric",
        }),
    }),
    {
      name: "dating-preferences",
      version: 1,
      partialize: (state) => ({ distanceUnit: state.distanceUnit }),
    }
  )
);
