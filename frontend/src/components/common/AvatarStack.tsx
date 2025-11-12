import React from "react";
import { User as UserIcon } from "phosphor-react";

type Props = {
  avatars: (string | null | undefined)[];
  total?: number; // total active members for overflow +X indicator
  size?: number; // diameter of each avatar circle
  max?: number; // max avatars to display before showing +X bubble
  loading?: boolean; // when true, show skeleton circles instead of images/icons
};
const AvatarStack: React.FC<Props> = ({
  avatars,
  total,
  size = 24,
  max = 6,
  loading = false,
}) => {
  // Restrict display to max; if fewer avatars provided, show those.
  const show = Array.isArray(avatars)
    ? avatars
        .map((value) => {
          if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
          }
          return null;
        })
        .slice(0, max)
    : [];
  const count = show.length;
  const remain = total && total > 0 ? Math.max(total - count, 0) : 0;

  return (
    <div className="flex items-center">
      {loading
        ? Array.from({
            length: Math.max(
              1,
              Math.min(max, total && total > 0 ? total : max)
            ),
          }).map((_, i) => (
            <div
              key={`sk-${i}`}
              className={`relative rounded-full ring-2 ring-white bg-gray-200 animate-pulse ${
                i === 0 ? "" : "-ml-2"
              }`}
              style={{ width: size, height: size }}
              aria-hidden
            />
          ))
        : show.map((src, i) => (
            <div
              key={i}
              className={`relative rounded-full ring-2 ring-white bg-gray-200 flex items-center justify-center overflow-hidden ${
                i === 0 ? "" : "-ml-2"
              }`}
              style={{ width: size, height: size }}
            >
              {src ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <img
                  src={src}
                  className="w-full h-full object-cover"
                  draggable={false}
                  alt={"member avatar"}
                />
              ) : (
                <UserIcon
                  size={Math.max(12, Math.floor(size * 0.6))}
                  className="text-gray-500"
                />
              )}
            </div>
          ))}
      {remain > 0 && (
        <div
          className={`relative rounded-full ring-2 ring-white bg-gray-300 text-gray-800 font-semibold flex items-center justify-center ${
            count > 0 ? "-ml-2" : ""
          }`}
          style={{ width: size, height: size }}
          title={`${remain} more members`}
        >
          <span className="text-[10px] leading-none">+{remain}</span>
        </div>
      )}
    </div>
  );
};

export default AvatarStack;
