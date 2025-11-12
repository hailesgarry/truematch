import React, { useMemo, useState } from "react";
import Cropper from "react-easy-crop";
import { cropImageToBlob, type Area } from "../utils/cropImage";
import { useAuthStore } from "../stores/authStore";
import { useNavigate, Navigate } from "react-router-dom";
import { resolveAvatarUrl } from "../utils/onboarding";

const LegacyMigratePage: React.FC = () => {
  const { username, avatar, needsMigration, signup, error, loading } =
    useAuthStore();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [croppedFile, setCroppedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showCrop, setShowCrop] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [localError, setLocalError] = useState("");
  const previewUrl = useMemo(() => {
    if (croppedFile) return URL.createObjectURL(croppedFile);
    if (avatarFile) return URL.createObjectURL(avatarFile);
    return avatar || "";
  }, [avatarFile, croppedFile, avatar]);
  const allowedMimes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/svg+xml",
  ]);
  const maxBytes = 5 * 1024 * 1024;
  const pickFile = (file: File | null) => {
    setLocalError("");
    if (!file) {
      setAvatarFile(null);
      setCroppedFile(null);
      return;
    }
    const type = file.type || "";
    if (!allowedMimes.has(type)) {
      setLocalError(
        "Unsupported file type. Use JPG, PNG, WebP, GIF, AVIF or SVG."
      );
      setAvatarFile(null);
      return;
    }
    if (file.size > maxBytes) {
      setLocalError("File is too large. Max size is 5 MB.");
      setAvatarFile(null);
      return;
    }
    setAvatarFile(file);
    setCroppedFile(null);
    setShowCrop(!!file);
  };
  if (!needsMigration) return <Navigate to="/login" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (avatarFile && !croppedFile) {
      setLocalError("Please apply crop before continuing.");
      return;
    }
    setUploading(true);
    setProgress(0);
    const { url, error: upErr } = await resolveAvatarUrl(
      username || "",
      croppedFile,
      (p) => setProgress(p)
    );
    setUploading(false);
    if (upErr) {
      setLocalError("Upload failed. Try another image or skip for now.");
    }
    await signup(username, password, url || avatar || null);
    if (!error) {
      navigate("/", { replace: true });
    }
  };

  return (
    <div className="max-w-sm mx-auto p-6">
      <h1 className="text-xl font-semibold mb-4">Finish Account Setup</h1>
      <p className="text-sm text-gray-600 mb-4">
        We detected a legacy local session for{" "}
        <strong>{username || "(unknown)"}</strong>. Set a password to secure
        your profile.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Password</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            className="w-full border rounded px-3 py-2 text-sm"
            required
            minLength={8}
            autoComplete="new-password"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Use at least 8 characters with a mix of cases and a number or
            symbol.
          </p>
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium">Avatar (optional)</label>
          <div
            className="border border-dashed rounded px-3 py-6 text-sm text-gray-600 flex flex-col items-center gap-2"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const f = e.dataTransfer.files?.[0] || null;
              if (f) pickFile(f);
            }}
          >
            {previewUrl ? (
              <div className="w-full flex flex-col items-center gap-2">
                <img
                  src={previewUrl}
                  alt="Avatar preview"
                  className="w-24 h-24 rounded-full object-cover"
                />
                <button
                  type="button"
                  className="text-xs text-gray-700 underline"
                  onClick={() => pickFile(null)}
                >
                  Remove
                </button>
              </div>
            ) : (
              <>
                <div>Drag and drop an image here</div>
                <div className="text-[11px]">or</div>
              </>
            )}
            <label className="inline-block">
              <span className="sr-only">Choose avatar</span>
              <input
                type="file"
                accept="image/*"
                className="block w-full text-sm"
                onChange={(e) => pickFile(e.target.files?.[0] || null)}
              />
            </label>
            <div className="text-[11px] text-gray-500 mt-1">
              Max 5 MB. JPG, PNG, WebP, GIF, AVIF, SVG.
            </div>
            {uploading && (
              <div className="w-full mt-2">
                <div className="h-2 w-full bg-gray-200 rounded">
                  <div
                    className="h-2 bg-blue-600 rounded"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="text-[11px] text-gray-600 mt-1">
                  Uploading… {progress}%
                </div>
              </div>
            )}
          </div>
          {localError && (
            <div className="text-xs text-red-600">{localError}</div>
          )}
        </div>
        {error && (
          <div className="text-xs text-red-600" role="alert">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading || uploading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded py-2 text-sm font-medium"
        >
          {loading || uploading ? "Saving…" : "Save & Continue"}
        </button>
      </form>
      {showCrop && avatarFile && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded shadow-lg w-full max-w-md p-4 space-y-3">
            <div className="relative w-full h-64 bg-black/5 rounded">
              <Cropper
                image={
                  avatarFile ? URL.createObjectURL(avatarFile) : previewUrl
                }
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, areaPixels) =>
                  setCroppedAreaPixels(areaPixels as Area)
                }
              />
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-full"
              />
              <span className="text-xs text-gray-600 w-10 text-right">
                {zoom.toFixed(2)}x
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1 text-sm"
                onClick={() => {
                  setShowCrop(false);
                  setCroppedAreaPixels(null);
                  setAvatarFile(null);
                  setCroppedFile(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
                onClick={async () => {
                  if (!avatarFile || !croppedAreaPixels) return;
                  try {
                    const blob = await cropImageToBlob(
                      avatarFile,
                      croppedAreaPixels,
                      0,
                      "image/jpeg",
                      0.92
                    );
                    const f = new File(
                      [blob],
                      avatarFile.name.replace(/\.[^.]+$/, ".jpg"),
                      { type: "image/jpeg" }
                    );
                    setCroppedFile(f);
                    setShowCrop(false);
                  } catch {}
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LegacyMigratePage;
