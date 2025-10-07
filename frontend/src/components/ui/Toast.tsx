import React from "react";
import { CheckCircle } from "phosphor-react";
import { useUiStore } from "../../stores/uiStore";

const Toast: React.FC = () => {
  const { toast } = useUiStore();

  if (!toast.visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="status"
      aria-live="polite"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Modal content */}
      <div className="relative bg-white px-4 py-3 rounded-xl shadow-xl border border-green-200 flex items-center gap-2">
        <CheckCircle size={20} weight="fill" className="text-green-600" />
        <span className="text-sm text-gray-800">{toast.message}</span>
      </div>
    </div>
  );
};

export default Toast;
