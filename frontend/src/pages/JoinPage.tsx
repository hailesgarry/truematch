import React, { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import FunlyLogo from "../components/common/FunlyLogo";
import { useAuthStore } from "../stores/authStore";
import { createAvatar } from "@dicebear/core";
import { avataaars } from "@dicebear/collection";

// Generate a random Avataaars avatar for a given name
const getDiceBearAvatar = async (name: string) => {
  const seed = (name || "user").trim();
  try {
    return await createAvatar(avataaars, {
      seed,
      backgroundColor: ["65c9ff", "ffdfbf", "e6e6e6", "ffd5dc", "d2eff3"],
      backgroundType: ["gradientLinear"],
      radius: 50,
    }).toDataUri();
  } catch {
    return generateMonogramAvatar(seed);
  }
};

// add this tiny zero-dependency fallback (inline SVG data URI)
function generateMonogramAvatar(name: string) {
  const s = name.trim().toUpperCase() || "?";
  const initials =
    s
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("") || "?";
  const hash = Array.from(s).reduce(
    (h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0,
    0
  );
  const colors = [
    "#2563eb",
    "#db2777",
    "#059669",
    "#7c3aed",
    "#ea580c",
    "#0891b2",
    "#16a34a",
    "#9333ea",
  ];
  const bg = colors[Math.abs(hash) % colors.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'>
    <defs>
      <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='${bg}' />
        <stop offset='100%' stop-color='#111827' stop-opacity='0.12'/>
      </linearGradient>
    </defs>
    <rect width='128' height='128' rx='64' fill='url(#g)' />
    <text x='50%' y='50%' dy='.35em' text-anchor='middle'
      font-family='system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
      font-size='56' font-weight='700' fill='white'>${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const JoinPage: React.FC = () => {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  // add this new state (generated local avatar)
  const [generatedAvatar, setGeneratedAvatar] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { login, error, joined } = useAuthStore();

  // Redirect if already logged in
  useEffect(() => {
    if (joined) {
      navigate("/groups", { replace: true });
    }
  }, [joined, navigate]);

  // Handle viewport height adjustments for mobile browsers
  useEffect(() => {
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--vh",
        `${window.innerHeight * 0.01}px`
      );
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);
    window.addEventListener("orientationchange", updateHeight);
    if ("ontouchstart" in window) {
      window.addEventListener("scroll", updateHeight);
    }

    return () => {
      window.removeEventListener("resize", updateHeight);
      window.removeEventListener("orientationchange", updateHeight);
      if ("ontouchstart" in window) {
        window.removeEventListener("scroll", updateHeight);
      }
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAvatar(ev.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onJoin = () => {
    const avatarUrl =
      avatar || generatedAvatar || generateMonogramAvatar(input);
    login(input, avatarUrl);
    if (input.trim()) {
      navigate("/groups", { replace: true });
    }
  };

  // generate/update the local avatar when the input changes (no network)
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!input.trim()) {
        if (!ignore) setGeneratedAvatar(null);
        return;
      }
      try {
        const uri = await getDiceBearAvatar(input);
        if (!ignore) setGeneratedAvatar(uri);
      } catch {
        if (!ignore) setGeneratedAvatar(generateMonogramAvatar(input));
      }
    })();
    return () => {
      ignore = true;
    };
  }, [input]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col w-full relative overflow-hidden"
      style={{
        height: "calc(var(--vh, 1vh) * 100)",
      }}
    >
      {/* Background image with fixed positioning */}
      <div
        className="fixed top-0 left-0 w-full h-full bg-cover bg-center bg-no-repeat z-0"
        style={{
          backgroundImage:
            "url('https://res.cloudinary.com/dopnzcfxj/image/upload/v1758693086/istockphoto-1389547553-612x612_kqtoje.jpg')",
        }}
      ></div>

      {/* Overlay with fixed positioning */}
      <div className="fixed top-0 left-0 w-full h-full bg-black opacity-50 z-0"></div>

      {/* Header with Logo and Tagline */}
      <div className="relative z-10 w-full flex flex-col items-center pt-12 pb-6">
        <FunlyLogo size="large" />
        <p className="text-white text-lg mt-2 opacity-90 font-medium tracking-wide">
          Connect. Chat. Have fun.
        </p>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center relative z-10">
        {/* Card with no borders, just padding and spacing */}
        <div className="bg-transparent p-8 rounded-lg w-full max-w-sm flex flex-col items-center">
          <div className="mb-16 flex flex-col items-center">
            {/* Image frame with glass effect */}
            <div className="w-32 h-32 rounded-full p-1.5 bg-white bg-opacity-20 backdrop-filter backdrop-blur-sm border border-white border-opacity-40 shadow-lg mb-4">
              <div className="w-full h-full rounded-full overflow-hidden">
                {avatar ? (
                  <img
                    src={avatar}
                    alt="avatar"
                    className="w-full h-full object-cover"
                  />
                ) : input.trim() ? (
                  <img
                    src={generatedAvatar || generateMonogramAvatar(input)}
                    alt="avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-white bg-opacity-10 flex items-center justify-center">
                    <span className="text-5xl text-red-500 opacity-90">?</span>
                  </div>
                )}
              </div>
            </div>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <button
              className="text-white text-sm px-5 py-2 rounded-full bg-transparent backdrop-filter backdrop-blur-sm border border-white border-opacity-80"
              onClick={() => fileInputRef.current?.click()}
            >
              Add a photo
            </button>
          </div>
          <div className="w-full mb-8">
            <input
              className="w-full px-0 py-3 border-0 border-b-[3px] border-white border-opacity-60 focus:border-opacity-100 mb-1 focus:outline-none bg-transparent text-white placeholder-white text-lg font-medium"
              type="text"
              placeholder="Enter a username"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onJoin();
              }}
              autoFocus
              style={{ caretColor: "white" }}
            />
          </div>
          {error && (
            <div className="text-red-300 text-sm mb-4 font-medium">{error}</div>
          )}
          <button
            className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3.5 px-4 rounded-lg transition duration-300 shadow-xl hover:shadow-2xl"
            onClick={onJoin}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
};

export default JoinPage;
