import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import BottomSheet from "./BottomSheet";

type Props = {
  username: string;
  avatarUrl?: string;
  children?: React.ReactNode; // optional custom trigger content
  onViewProfile?: (username: string) => void; // optional hook to handle profile action
  viewProfileColor?: "red" | "gray"; // control View profile button color
};

const UserQuickActions: React.FC<Props> = ({
  username,
  avatarUrl,
  children,
  onViewProfile,
  viewProfileColor = "gray",
}) => {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isPrivateChatPage = /^\/dm(\/|$)/.test(pathname);

  const openSheet = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setOpen(true);
  };
  const closeSheet = () => setOpen(false);

  const handleViewProfile = () => {
    if (onViewProfile) {
      onViewProfile(username);
    } else {
      navigate(`/u/${encodeURIComponent(username)}`);
    }
    closeSheet();
  };

  const handleMessage = () => {
    const fromChat = /^\/chat(\/|$)?/.test(pathname);
    navigate(`/dm/${encodeURIComponent(username)}`, {
      state: { from: fromChat ? "/chat" : "/direct" },
    });
    closeSheet();
  };

  // Trigger with keyboard support
  const trigger = children ?? (
    <span className="font-medium underline decoration-dotted cursor-pointer">
      {username}
    </span>
  );

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={openSheet}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openSheet();
          }
        }}
        className="inline-flex items-center"
      >
        {trigger}
      </span>

      <BottomSheet
        isOpen={open}
        onClose={closeSheet}
        ariaDescription={`Actions for ${username}`}
      >
        <div className="space-y-4 my-4">
          <div className="flex flex-col items-center gap-2 mb-2">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={`${username} avatar`}
                className="w-28 h-28 rounded-full object-cover"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-gray-300 flex items-center justify-center text-gray-700 text-xl font-bold">
                {username.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="text-sm font-semibold text-gray-900">
              {username}
            </div>
          </div>

          {/* Buttons stacked vertically: Message on top, View profile below */}
          <div className="mx-auto w-full max-w-[260px] flex flex-col gap-2">
            {!isPrivateChatPage && (
              <button
                type="button"
                onClick={handleMessage}
                className="w-full text-center px-3 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 focus:outline-none"
              >
                Message
              </button>
            )}
            <button
              type="button"
              onClick={handleViewProfile}
              className={
                viewProfileColor === "red"
                  ? "w-full text-center px-3 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 focus:outline-none"
                  : "w-full text-center px-3 py-2 rounded-lg bg-gray-100 text-gray-900 text-sm hover:bg-gray-200 focus:outline-none"
              }
              data-autofocus
            >
              View profile
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
};

export default UserQuickActions;
