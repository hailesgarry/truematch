import { create } from "zustand";

import type { Toast, ToastTone } from "../types";

interface UiState {
  toast: Toast;
  toastDuration: number;
  routeLoading: boolean;
  routeLoadingMessage: string;

  // Actions
  showToast: (message: string, duration?: number, tone?: ToastTone) => void;
  hideToast: () => void;
  startRouteLoading: (message?: string) => void;
  finishRouteLoading: (delayMs?: number) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  toast: {
    message: "",
    visible: false,
    tone: "neutral",
  },
  toastDuration: 3000,
  routeLoading: false,
  routeLoadingMessage: "Loading content…",

  showToast: (message, duration = 3000, tone = "neutral") => {
    set({ toast: { message, visible: true, tone }, toastDuration: duration });

    // Auto-hide toast after duration
    setTimeout(() => {
      set((state) => {
        if (state.toast.message === message) {
          return { toast: { ...state.toast, visible: false } };
        }
        return state;
      });
    }, duration);
  },

  hideToast: () =>
    set((state) => ({ toast: { ...state.toast, visible: false } })),

  startRouteLoading: (message = "Loading content…") =>
    set(() => ({ routeLoading: true, routeLoadingMessage: message })),

  finishRouteLoading: (delayMs = 0) => {
    if (delayMs > 0) {
      setTimeout(() => {
        set(() => ({ routeLoading: false }));
      }, delayMs);
    } else {
      set(() => ({ routeLoading: false }));
    }
  },
}));
