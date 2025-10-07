import React from "react";
import { Plus } from "phosphor-react";

type FloatingActionButtonProps = {
  onClick: () => void;
  ariaLabel?: string;
};

const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
  onClick,
  ariaLabel = "Create",
}) => {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="fixed right-5 bottom-20 z-20 w-14 h-14 rounded-full bg-[#FD1D1D] text-white shadow-[0_2px_10px_rgba(253,29,29,0.15),_0_6px_16px_rgba(0,0,0,0.05)] flex items-center justify-center active:scale-95 transition-transform"
    >
      <Plus size={28} weight="bold" />
    </button>
  );
};

export default FloatingActionButton;
