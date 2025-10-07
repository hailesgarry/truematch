import FunlyLogo from "../common/FunlyLogo";
import { useAuthStore } from "../../stores/authStore";

interface HeaderProps {
  onAvatarClick: () => void;
}

const Header = ({ onAvatarClick }: HeaderProps) => {
  const { username, avatar } = useAuthStore();

  return (
    <div className="flex items-center px-4 py-2 bg-white border-b border-gray-200 h-14">
      {/* Left: App logo */}
      <div className="flex items-center">
        <AppLogo />
      </div>

      {/* Spacer to push right section */}
      <div className="flex-1" />

      {/* Right: avatar */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onAvatarClick}
          className="focus:outline-none rounded-full"
          aria-label="Open user menu"
        >
          {avatar ? (
            <img
              src={avatar}
              alt={(username || "User") + " avatar"}
              className="w-9 h-9 rounded-full border border-gray-200 shadow cursor-pointer hover:opacity-80 transition-opacity"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-gray-200 cursor-pointer hover:bg-gray-300 transition-colors" />
          )}
        </button>
      </div>
    </div>
  );
};

// Custom Funly logo component
const AppLogo = () => (
  <div className="flex items-center justify-center">
    <FunlyLogo size="medium" />
  </div>
);

export default Header;
