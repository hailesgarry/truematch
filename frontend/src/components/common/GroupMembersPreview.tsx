import React, { useMemo } from "react";
import AvatarStack from "./AvatarStack";

const DISPLAY_COUNT = 5;

type Props = {
  avatars?: (string | null | undefined)[];
  total?: number | null;
  loading?: boolean;
};

const GroupMembersPreview: React.FC<Props> = ({
  avatars,
  total,
  loading = false,
}) => {
  const sanitizedAvatars = useMemo(() => {
    if (!Array.isArray(avatars)) return [];
    return avatars
      .map((value) => {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      })
      .filter((value): value is string => value !== null);
  }, [avatars]);

  const displayAvatars = useMemo(() => {
    if (sanitizedAvatars.length === 0) {
      return [];
    }
    return sanitizedAvatars.slice(0, DISPLAY_COUNT);
  }, [sanitizedAvatars]);

  const normalizedTotal = useMemo(() => {
    if (typeof total === "number" && Number.isFinite(total) && total > 0) {
      return Math.floor(total);
    }
    return sanitizedAvatars.length;
  }, [total, sanitizedAvatars]);

  const shouldShowPlaceholder = loading && sanitizedAvatars.length === 0;
  const stackAvatars = shouldShowPlaceholder
    ? Array(DISPLAY_COUNT).fill(null)
    : displayAvatars;
  const stackTotal = shouldShowPlaceholder ? DISPLAY_COUNT : normalizedTotal;

  return (
    <div className="flex items-center">
      <AvatarStack
        avatars={stackAvatars}
        total={stackTotal}
        size={32}
        max={DISPLAY_COUNT}
        loading={loading && shouldShowPlaceholder}
      />
    </div>
  );
};

export default GroupMembersPreview;
