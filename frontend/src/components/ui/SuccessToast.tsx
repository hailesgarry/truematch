import React, { useEffect } from "react";
import { CheckCircle } from "phosphor-react";

export interface SuccessToastProps {
  open: boolean;
  message: string;
  onClose?: () => void;
  duration?: number;
}

const SuccessToast: React.FC<SuccessToastProps> = ({
  open,
  message,
  onClose,
  duration = 2800,
}) => {
  useEffect(() => {
    if (!open || !onClose) return;
    const timer = window.setTimeout(() => {
      onClose();
    }, duration);
    return () => window.clearTimeout(timer);
  }, [open, duration, onClose, message]);

  if (!message) {
    return null;
  }

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-6 z-[160] flex justify-center transition-all duration-200 ${
        open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-500/30">
        <CheckCircle size={18} weight="fill" aria-hidden />
        <span>{message}</span>
      </div>
    </div>
  );
};

export default SuccessToast;
