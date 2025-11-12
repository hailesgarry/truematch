import React from "react";
import BottomSheet from "./BottomSheet";
import { WarningCircle } from "phosphor-react";

export interface DiscardChangesSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onSave?: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  saveLabel?: string;
  showCancel?: boolean;
}

const DiscardChangesSheet: React.FC<DiscardChangesSheetProps> = ({
  isOpen,
  onClose,
  onCancel,
  onConfirm,
  onSave,
  title,
  description,
  confirmLabel = "Discard",
  cancelLabel = "Cancel",
  saveLabel = "Save",
  showCancel = true,
}) => {
  const header =
    title ?? (
      <div className="w-full flex items-center justify-center gap-2">
        <WarningCircle size={18} className="text-red-600" aria-hidden="true" />
        <span>Discard changes?</span>
      </div>
    );

  const body =
    description ?? (
      <p className="text-sm text-gray-500 text-center leading-relaxed">
        You have unsaved changes. Are you sure you want to discard them?
      </p>
    );

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={header}>
      <div className="space-y-5 px-1">
        {body}
        {onSave ? (
          showCancel ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={onSave}
                className="w-full px-4 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700 font-semibold shadow"
              >
                {saveLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="w-full px-4 py-2.5 rounded-lg bg-gray-100 text-gray-900 hover:bg-gray-200 font-medium"
              >
                {confirmLabel}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="w-full px-4 py-2.5 rounded-lg border text-gray-900 hover:bg-gray-50 font-medium"
              >
                {cancelLabel}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onSave}
                className="w-full px-4 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700 font-semibold shadow"
              >
                {saveLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="w-full px-4 py-2.5 rounded-lg bg-gray-100 text-gray-900 hover:bg-gray-200 font-medium"
              >
                {confirmLabel}
              </button>
            </div>
          )
        ) : (
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="min-w-[104px] px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 font-medium"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="min-w-[140px] px-4 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700 font-semibold shadow"
            >
              {confirmLabel}
            </button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
};

export default DiscardChangesSheet;
