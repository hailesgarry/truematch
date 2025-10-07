import React from "react";
import { User as UserIcon } from "phosphor-react";

type Props = {
  avatars: (string | null | undefined)[];
  total?: number;
  size?: number;
};

const AvatarStack: React.FC<Props> = ({ avatars, total, size = 24 }) => {
  const show = Array.isArray(avatars) ? avatars.slice(0, 3) : [];
  const count = show.length;
  const remain = total && total > 0 ? Math.max(total - count, 0) : 0;

  return (
    <div className="flex items-center">
      {show.map((src, i) => (
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
