import React from "react";
import { useNavigate } from "react-router-dom";
import { At, BellSlash, Eye } from "@phosphor-icons/react";
import DropDown, { type DropDownItem } from "./DropDown";
import { navigateToUserProfile } from "../../lib/userIdentity";

type Props = {
  username: string;
  userId?: string;
  avatarUrl?: string;
  children?: React.ReactNode; // optional custom trigger content
  onViewProfile?: (username: string) => void; // optional hook to handle profile action
  viewProfileColor?: "red" | "gray"; // control View profile button color
  onMention?: (username: string) => void;
  onFilterUser?: (username: string) => void;
};

const UserQuickActions: React.FC<Props> = ({
  username,
  userId,
  avatarUrl,
  children,
  onViewProfile,
  viewProfileColor = "gray",
  onMention,
  onFilterUser,
}) => {
  const navigate = useNavigate();

  const safeUsername =
    typeof username === "string" && username.trim().length > 0
      ? username.trim()
      : "unknown";
  const safeUserId =
    typeof userId === "string" && userId.trim().length > 0 ? userId.trim() : "";

  const handleViewProfile = React.useCallback(() => {
    if (onViewProfile) {
      onViewProfile(safeUsername);
    } else {
      if (!safeUserId && safeUsername === "unknown") return;
      void navigateToUserProfile(navigate, {
        userId: safeUserId || undefined,
        username: safeUsername !== "unknown" ? safeUsername : undefined,
      });
    }
  }, [navigate, onViewProfile, safeUserId, safeUsername]);

  // Trigger with keyboard support
  const trigger = children ?? (
    <span className="font-medium underline decoration-dotted cursor-pointer">
      {safeUsername}
    </span>
  );

  const menuItems = React.useMemo<DropDownItem[]>(() => {
    const header: DropDownItem = {
      key: "header",
      closeOnSelect: false,
      renderCustom: () => (
        <div className="flex flex-col items-center gap-2 px-4 pt-4 pb-3 border-b border-gray-100 text-center">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={`${safeUsername} avatar`}
              className="w-24 h-24 rounded-full object-cover"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gray-300 flex items-center justify-center text-gray-700 text-xl font-bold">
              {safeUsername.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="text-sm font-semibold text-gray-900">
            {safeUsername}
          </div>
        </div>
      ),
    };

    const items: DropDownItem[] = [header];

    type IconComponent = React.ComponentType<{
      size?: number;
      weight?: React.ComponentProps<typeof Eye>["weight"];
      className?: string;
    }>;

    const renderActionItem = (
      label: string,
      action: () => void,
      tone: "primary" | "neutral",
      Icon?: IconComponent
    ): DropDownItem => ({
      key: label.toLowerCase().replace(/\s+/g, "-"),
      renderCustom: ({ close }) => (
        <div className="px-4 py-2">
          <button
            type="button"
            className={`flex w-full items-center gap-2 p-0 text-left text-sm font-medium focus:outline-none transition ${
              tone === "primary" ? "text-red-600" : "text-gray-900"
            }`}
            onClick={() => {
              action();
              close();
            }}
          >
            {Icon ? (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 shrink-0">
                <Icon size={20} weight="fill" />
              </span>
            ) : null}
            <span>{label}</span>
          </button>
        </div>
      ),
    });

    if (onMention) {
      items.push(
        renderActionItem(
          "Mention",
          () => onMention(safeUsername),
          "neutral",
          At
        )
      );
    }

    if (onFilterUser) {
      items.push(
        renderActionItem(
          "Mute",
          () => onFilterUser(safeUsername),
          "primary",
          BellSlash
        )
      );
    }

    items.push(
      renderActionItem(
        "View profile",
        handleViewProfile,
        viewProfileColor === "red" ? "primary" : "neutral",
        Eye
      )
    );

    return items;
  }, [
    avatarUrl,
    handleViewProfile,
    onFilterUser,
    onMention,
    safeUsername,
    viewProfileColor,
  ]);

  return (
    <>
      <DropDown
        placement="bottom-start"
        disabled={false}
        items={menuItems}
        openAnimation="slide-from-left"
        renderTrigger={({ toggle }) => (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggle();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
              }
            }}
            className="inline-flex items-center"
          >
            {trigger}
          </span>
        )}
      />
    </>
  );
};

export default UserQuickActions;
