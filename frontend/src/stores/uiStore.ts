import { create } from "zustand";
import type { Toast } from "../types";

interface UiState {
  toast: Toast;
  toastDuration: number;

  // Actions
  showToast: (message: string, duration?: number) => void;
  hideToast: () => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  toast: {
    message: "",
    visible: false,
  },
  toastDuration: 3000,

  showToast: (message, duration = 3000) => {
    set({ toast: { message, visible: true }, toastDuration: duration });

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
}));
