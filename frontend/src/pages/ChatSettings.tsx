import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useSocketStore } from "../stores/socketStore";
import { useUiStore } from "../stores/uiStore";
import { DEFAULT_BUBBLE_PALETTE } from "../utils/bubbles"; // NEW
import { ArrowLeft, CheckCircle } from "phosphor-react"; // NEW

// Use the shared pastel palette for chat bubbles
const BUBBLE_COLORS = DEFAULT_BUBBLE_PALETTE.map((hex) => ({
  name: hex, // show the hex for clarity
  value: hex,
}));

const ChatSettings: React.FC = () => {
  const navigate = useNavigate();
  const { joined } = useAuthStore();
  const { updateBubbleColor } = useSocketStore();
  const { showToast } = useUiStore();

  const [selectedColor, setSelectedColor] = useState(() => {
    return localStorage.getItem("chat-bubble-color") || "";
  });
  const [initialColor, setInitialColor] = useState<string>("");

  // Redirect if not logged in
  useEffect(() => {
    if (!joined) {
      navigate("/", { replace: true });
    }
  }, [joined, navigate]);

  // Capture the initial color for comparison and to control Save enablement
  useEffect(() => {
    const stored = localStorage.getItem("chat-bubble-color") || "";
    setInitialColor(stored);
  }, []);

  const handleColorChange = (color: string) => {
    setSelectedColor(color);
    updateBubbleColor(color);
    localStorage.setItem("chat-bubble-color", color);
  };

  const handleSave = () => {
    showToast("Chat settings updated!");
    navigate("/groups", { replace: true });
  };

  const saveDisabled = selectedColor === initialColor;

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Header (sticky) with back/title on left and Save on right */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="max-w-md mx-auto flex items-center justify-between gap-2 px-4 h-14 sm:h-16">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              className="text-gray-900 focus:outline-none "
              onClick={() => navigate(-1)}
              aria-label="Back"
            >
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-base font-semibold text-gray-900 truncate">
              Chat settings
            </h1>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveDisabled}
            aria-disabled={saveDisabled}
            className={`px-3 py-1.5 text-sm rounded-md text-white focus:outline-none focus:ring-2 focus:ring-red-200 ${
              saveDisabled
                ? "bg-red-400/60 cursor-not-allowed opacity-60"
                : "bg-red-500 hover:bg-red-600"
            }`}
          >
            Save
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto w-full px-4 py-6">
          <div className="mb-6">
            <h2 className="text-lg font-medium text-gray-900">
              Message bubble color-picker
            </h2>
            <p className="text-sm text-gray-600 mb-3">
              Choose the color applied to your outgoing messages. Your selection
              is visible to all participants in rooms and private chats, and you
              can change it at any time.
            </p>
            <div className="grid grid-cols-3 gap-4">
              {BUBBLE_COLORS.map((color) => (
                <div
                  key={color.value}
                  className={`flex flex-col items-center p-2 rounded-lg cursor-pointer transition hover:bg-gray-50`}
                  onClick={() => handleColorChange(color.value)}
                >
                  <div
                    className="relative w-12 h-12 rounded-lg mb-1"
                    style={{ backgroundColor: color.value }}
                  >
                    {selectedColor === color.value && (
                      <span className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-white">
                        <CheckCircle
                          size={18}
                          weight="fill"
                          className="text-red-500"
                        />
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-600">{color.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* In-form action row removed; Save moved to header */}
        </div>
      </div>

      <div className="h-3" />
    </div>
  );
};

export default ChatSettings;
