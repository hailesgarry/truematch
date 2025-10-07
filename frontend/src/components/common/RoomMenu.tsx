import React from "react";
import { createPortal } from "react-dom";
import {
  DotsThreeVertical,
  SignOut,
  UsersThree,
  ShareFat,
} from "@phosphor-icons/react";
import ShareRoomButton from "./ShareRoomButton";
import { useNavigate } from "react-router-dom";

type Props = {
  onLeaveRoom: () => void;
  className?: string; // wrapper classes (e.g., ml-auto)
  buttonClassName?: string; // customizes the trigger button appearance
  groupId?: string | null;
  groupName?: string | null;
};

const RoomMenu: React.FC<Props> = ({
  onLeaveRoom,
  className,
  buttonClassName,
  groupId,
  groupName,
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const firstItemRef = React.useRef<HTMLButtonElement | null>(null);
  const [coords, setCoords] = React.useState<{
    top: number;
    right: number;
  } | null>(null);

  const updatePosition = React.useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    setCoords({ top: 56, right: 16 });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    updatePosition();
    const click = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onResize = () => updatePosition();
    const onScroll = () => updatePosition();
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
    };
  }, [open, updatePosition]);

  return (
    <div className={`relative inline-flex ${className || ""}`} ref={menuRef}>
      {/* Hidden triggerless ShareRoomButton mounted once so its sheet lives outside the ephemeral menu */}
      <ShareRoomButton
        groupId={groupId}
        groupName={groupName}
        renderTrigger={false}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        ref={btnRef}
        className={`menu-btn ml-auto focus:outline-none ${
          buttonClassName || "text-white"
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Room options"
      >
        <DotsThreeVertical size={24} weight="bold" />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[200px] rounded-lg border bg-white shadow-lg text-sm overflow-hidden"
            role="menu"
            aria-label="Room options menu"
            style={{ top: coords.top, right: coords.right }}
          >
            {/* Share room */}
            <button
              ref={firstItemRef}
              type="button"
              className="flex items-center gap-2 w-full text-left px-3 py-2  text-gray-900"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setShareOpen(true);
              }}
            >
              <ShareFat size={22} className="text-gray-700" />
              <span>Share room</span>
            </button>

            <div className="my-1 h-px bg-gray-200" role="separator" />

            <button
              type="button"
              className="flex items-center gap-2 w-full text-left px-3 py-2  text-gray-900"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate("/active-members");
              }}
            >
              <UsersThree size={22} className="text-gray-700" />
              <span>Active users</span>
            </button>

            <div className="my-1 h-px bg-gray-200" role="separator" />

            <button
              type="button"
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-red-600"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLeaveRoom();
              }}
            >
              <SignOut size={22} className="text-red-600" />
              <span>Leave room</span>
            </button>
          </div>,
          document.body
        )}
    </div>
  );
};

export default RoomMenu;
