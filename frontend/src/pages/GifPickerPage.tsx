import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "phosphor-react";
import GifPicker, { Theme } from "gif-picker-react";
import type { TenorImage } from "gif-picker-react";
import { useSocketStore } from "../stores/socketStore";
import { useComposerStore } from "../stores/composerStore";
import { addRecentGif, loadRecentGifs, type RecentGif } from "../utils/recents";

const tenorKey = import.meta.env.VITE_TENOR_API_KEY as string | undefined;

const GifPickerPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // group + DM senders
  const sendMessage = useSocketStore((s) => s.sendMessage);
  const sendDirectMessage = useSocketStore((s) => s.sendDirectMessage);
  const activeDmId = useSocketStore((s) => s.activeDmId);
  const replyTarget = useComposerStore((s) => s.replyTarget);
  const clearReplyTarget = useComposerStore((s) => s.clearReplyTarget);

  // Prefer dmId passed via navigation; fallback to store
  const stateDmId = (location.state as any)?.dmId as string | undefined;
  const effectiveDmId = stateDmId || activeDmId;

  const [recent, setRecent] = React.useState<RecentGif[]>(() =>
    loadRecentGifs()
  );

  const handleSelect = (gif: TenorImage) => {
    const g: any = gif;
    const formats = g.media_formats || {};
    const allCandidates: string[] = [];
    ["gif", "tinygif", "mediumgif", "preview"].forEach((k) => {
      if (formats[k]?.url) allCandidates.push(formats[k].url);
    });
    if (gif.url) allCandidates.push(gif.url);

    let mp4: string | undefined;
    let webm: string | undefined;
    for (const key of Object.keys(formats)) {
      const lower = key.toLowerCase();
      if (!mp4 && lower.includes("mp4") && formats[key]?.url)
        mp4 = formats[key].url;
      if (!webm && lower.includes("webm") && formats[key]?.url)
        webm = formats[key].url;
    }

    const original = allCandidates.find(Boolean);
    if (!original) {
      navigate(-1);
      return;
    }

    const media = {
      original,
      gif: formats.gif?.url || original,
      mp4,
      webm,
      preview: formats.preview?.url || formats.tinygif?.url,
    };

    // CHANGED: use DM API when in a DM, else group API
    if (effectiveDmId) {
      sendDirectMessage(original, replyTarget || null, {
        kind: "gif",
        media,
        dmId: effectiveDmId, // ensure DM routing even if store cleared active DM
      });
    } else {
      sendMessage(original, replyTarget || null, { kind: "gif", media });
    }
    clearReplyTarget();

    addRecentGif({
      id: gif.id || media.original,
      preview: media.preview || media.gif || media.original,
      gif: media.gif,
      mp4: media.mp4,
      webm: media.webm,
      original: media.original,
    });
    setRecent(loadRecentGifs());
    navigate(-1);
  };

  const quickSendRecent = (r: RecentGif) => {
    // CHANGED: same DM-aware logic for quick sends
    const meta = {
      kind: "gif" as const,
      media: {
        original: r.original,
        gif: r.gif || r.original,
        mp4: r.mp4,
        webm: r.webm,
        preview: r.preview,
      },
      ...(effectiveDmId ? { dmId: effectiveDmId } : {}),
    };
    if (effectiveDmId) {
      sendDirectMessage(r.original, replyTarget || null, meta);
    } else {
      sendMessage(r.original, replyTarget || null, meta);
    }
    clearReplyTarget();
    addRecentGif(r);
    setRecent(loadRecentGifs());
    navigate(-1);
  };

  if (!tenorKey) {
    return (
      <div className="flex flex-col min-h-[100dvh] bg-white overscroll-y-contain overflow-y-auto pt-[calc(env(safe-area-inset-top)+56px)] pb-[env(safe-area-inset-bottom)]">
        <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center gap-4 px-4 border-b bg-white">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back to chat"
            className="text-gray-900"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-sm font-semibold text-gray-900">GIF Picker</h1>
        </header>
        <div className="p-4 text-sm text-red-500">
          Missing Tenor API key. Set VITE_TENOR_API_KEY in your .env file.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[100dvh] bg-white overscroll-y-contain overflow-y-auto pt-[calc(env(safe-area-inset-top)+56px)] pb-[env(safe-area-inset-bottom)]">
      <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center gap-4 px-4 border-b bg-white">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back to chat"
          className="text-gray-900"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-base font-semibold text-gray-900">Pick a GIF</h1>
      </header>

      {recent.length > 0 && (
        <div className="px-4 pt-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            Recent
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 border-b">
            {recent.map((r) => (
              <button
                key={r.id}
                onClick={() => quickSendRecent(r)}
                className="relative flex-shrink-0 w-24 h-24 rounded-md overflow-hidden focus:outline-none"
              >
                <img
                  src={r.preview || r.gif || r.original}
                  alt="Recent GIF"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {/* Small overlay play icon optional */}
                <span className="absolute bottom-1 right-1 bg-black/50 text-white text-[10px] px-1 rounded">
                  GIF
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden m-4">
        <GifPicker
          tenorApiKey={tenorKey}
          theme={Theme.LIGHT}
          onGifClick={handleSelect}
          width="100%"
          height="100%"
        />
      </div>
    </div>
  );
};

export default GifPickerPage;
