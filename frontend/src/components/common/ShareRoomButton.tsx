import React from "react";
import {
  ShareFat,
  Copy,
  Check,
  WhatsappLogo,
  FacebookLogo,
  EnvelopeSimple,
  LinkSimple,
} from "@phosphor-icons/react";
import { useUiStore } from "../../stores/uiStore";
import BottomSheet from "./BottomSheet";
import QrCanvas from "./QrCanvas";

type Props = {
  groupId?: string | null;
  groupName?: string | null;
  className?: string;
  title?: string;
  ariaLabel?: string;
  onShared?: (link: string) => void; // optional callback when a share/copy happens
  variant?: "icon" | "menu-item"; // how to render the trigger
  onOpen?: () => void; // optional callback when trigger is clicked (before opening sheet)
  // Controlled mode: allow parent to manage sheet visibility
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Allow rendering sheet without a visible trigger button
  renderTrigger?: boolean;
};

/**
 * ShareRoomButton
 * - Builds a deep link to the current room: /chat?gid=<id>&gname=<name>
 * - Uses Web Share API when available
 * - Falls back to copying to clipboard with toast feedback
 */
const ShareRoomButton: React.FC<Props> = ({
  groupId,
  groupName,
  className = "",
  title = "Share",
  ariaLabel = "Share room",
  onShared,
  variant = "icon",
  onOpen,
  open,
  onOpenChange,
  renderTrigger = true,
}) => {
  const showToast = useUiStore((s) => s.showToast);
  const [isOpen, setIsOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const sheetOpen = open ?? isOpen;
  const setSheetOpen = onOpenChange ?? setIsOpen;

  const buildLink = React.useCallback(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = new URL("/chat", origin || "http://localhost");
    if (groupId) url.searchParams.set("gid", groupId);
    if (groupName) url.searchParams.set("gname", groupName);
    return url.toString();
  }, [groupId, groupName]);

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}

    // Fallback: temporary textarea
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      return true;
    } catch {
      return false;
    }
  };

  const onClick = () => {
    if (!groupId) {
      showToast("Select a room first", 2000);
      return;
    }
    onOpen?.();
    setCopied(false);
    setSheetOpen(true);
  };

  const link = buildLink();
  const titleText = groupName ? `${groupName} · Funly Chat` : "Funly Chat Room";

  const handleCopy = async () => {
    const ok = await copyToClipboard(link);
    if (ok) {
      setCopied(true);
      showToast("Link copied to clipboard", 1800);
      setTimeout(() => setCopied(false), 1800);
      onShared?.(link);
    } else {
      showToast("Could not copy link", 2200);
    }
  };

  const handleCopyMarkdown = async () => {
    const md = `[${titleText}](${link})`;
    const ok = await copyToClipboard(md);
    showToast(ok ? "Markdown link copied" : "Copy failed", 1800);
    if (ok) onShared?.(link);
  };

  const handleCopyHTML = async () => {
    const html = `<a href="${link}">${titleText}</a>`;
    const ok = await copyToClipboard(html);
    showToast(ok ? "HTML link copied" : "Copy failed", 1800);
    if (ok) onShared?.(link);
  };

  return (
    <>
      {renderTrigger &&
        (variant === "menu-item" ? (
          <button
            type="button"
            aria-label={ariaLabel}
            title={title}
            className={`flex items-center gap-2 w-full text-left px-3 py-2 text-gray-900 ${className}`}
            onClick={onClick}
          >
            <ShareFat size={20} className="text-gray-700" />
            <span>Share room</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={ariaLabel}
            title={title}
            className={className}
            onClick={onClick}
          >
            <ShareFat size={24} />
          </button>
        ))}

      <BottomSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Share room"
        ariaDescription="Share this room link with others"
      >
        <div className="space-y-4">
          {/* Link box */}
          <div className="border rounded-md p-2 flex items-center gap-2 bg-gray-50">
            <LinkSimple size={18} className="text-gray-600 flex-shrink-0" />
            <input
              type="text"
              readOnly
              value={link}
              className="flex-1 bg-transparent text-sm text-gray-800 outline-none select-all"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border hover:bg-gray-50 text-sm"
            >
              {copied ? (
                <>
                  <Check size={16} /> Copied
                </>
              ) : (
                <>
                  <Copy size={16} /> Copy
                </>
              )}
            </button>
          </div>

          {/* Quick share options */}
          <div>
            <div className="text-xs font-medium text-gray-500 mb-2">
              Share via
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <a
                className="flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-gray-50"
                href={`https://wa.me/?text=${encodeURIComponent(
                  `${titleText} ${link}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <WhatsappLogo size={18} className="text-green-600" />
                <span className="text-sm">WhatsApp</span>
              </a>
              <a
                className="flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-gray-50"
                href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
                  link
                )}&quote=${encodeURIComponent(titleText)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FacebookLogo size={18} className="text-blue-600" />
                <span className="text-sm">Facebook</span>
              </a>
              <a
                className="flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-gray-50"
                href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(
                  link
                )}&text=${encodeURIComponent(titleText)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* Phosphor doesn't have X logo; reuse Link icon colorized */}
                <LinkSimple size={18} className="text-black" />
                <span className="text-sm">Post on X</span>
              </a>
              <a
                className="flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-gray-50"
                href={`mailto:?subject=${encodeURIComponent(
                  titleText
                )}&body=${encodeURIComponent(link)}`}
              >
                <EnvelopeSimple size={18} className="text-gray-700" />
                <span className="text-sm">Email</span>
              </a>
            </div>
          </div>

          {/* Advanced copy formats */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="text-xs rounded-md border px-2 py-1.5 hover:bg-gray-50"
            >
              Copy plain
            </button>
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="text-xs rounded-md border px-2 py-1.5 hover:bg-gray-50"
            >
              Copy Markdown
            </button>
            <button
              type="button"
              onClick={handleCopyHTML}
              className="text-xs rounded-md border px-2 py-1.5 hover:bg-gray-50"
            >
              Copy HTML
            </button>
          </div>

          {/* QR code for offline/desktop sharing */}
          <div className="pt-1">
            <div className="text-xs font-medium text-gray-500 mb-2">
              QR code
            </div>
            <div className="flex items-center gap-3">
              <QrCanvas text={link} size={128} className="border rounded-md" />
              <div className="text-xs text-gray-600">
                Scan to join
                <div className="mt-2">
                  <button
                    type="button"
                    className="rounded-md border px-2 py-1 text-[11px] hover:bg-gray-50"
                    onClick={() => {
                      const canvas =
                        document.querySelector<HTMLCanvasElement>("canvas");
                      if (!canvas) return;
                      const data = canvas.toDataURL("image/png");
                      const a = document.createElement("a");
                      a.href = data;
                      a.download = `${(groupName || "room").replace(
                        /\s+/g,
                        "-"
                      )}-qr.png`;
                      a.click();
                    }}
                  >
                    Download PNG
                  </button>
                </div>
              </div>
            </div>
          </div>

          {typeof navigator !== "undefined" && (navigator as any).share && (
            <div className="pt-1">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await (navigator as any).share({
                      title: titleText,
                      url: link,
                    });
                    onShared?.(link);
                  } catch {}
                }}
                className="w-full text-sm rounded-md border px-3 py-2 hover:bg-gray-50"
              >
                More…
              </button>
            </div>
          )}
        </div>
      </BottomSheet>
    </>
  );
};

export default ShareRoomButton;
