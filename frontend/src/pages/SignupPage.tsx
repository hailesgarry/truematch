import React, { useMemo, useState } from "react";
import Cropper from "react-easy-crop";
import { cropImageToBlob, type Area } from "../utils/cropImage";
import { useAuthStore } from "../stores/authStore";
import { useNavigate, Navigate } from "react-router-dom";
import { resolveAvatarUrl } from "../utils/onboarding";

const SignupPage: React.FC = () => {
  const { signup, joined, loading, error } = useAuthStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [stepError, setStepError] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [croppedFile, setCroppedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [showCrop, setShowCrop] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const previewUrl = useMemo(() => {
    if (croppedFile) return URL.createObjectURL(croppedFile);
    if (avatarFile) return URL.createObjectURL(avatarFile);
    return "";
  }, [avatarFile, croppedFile]);

  const allowedMimes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/svg+xml",
  ]);
  const maxBytes = 5 * 1024 * 1024; // 5 MB

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
  const navigate = useNavigate();
  if (joined) return <Navigate to="/" replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) {
      // Basic client-side validation before moving to step 2
      const u = username.trim();
      const p = password;
      if (u.length < 3 || u.length > 32) {
        setStepError("Username must be 3-32 characters long.");
        return;
      }
      if (p.length < 8) {
        setStepError("Password must be at least 8 characters.");
        return;
      }
      setStepError("");
      setStep(2);
      return;
    }
    // If a file is chosen, require crop to be applied
    if (avatarFile && !croppedFile) {
      setLocalError("Please apply crop before continuing.");
      return;
    }
    setUploading(true);
    setProgress(0);
    const { url, error: upErr } = await resolveAvatarUrl(
      username.trim(),
      croppedFile,
      (p) => setProgress(p)
    );
    setUploading(false);
    if (upErr) {
      setLocalError("Upload failed. Try another image or skip for now.");
    }
    await signup(username.trim(), password, url);
    if (!error) {
      navigate("/");
    }
  };
  return (
    <div className="max-w-sm mx-auto p-6">
      <h1 className="text-xl font-semibold mb-4">Create account</h1>
      <form onSubmit={submit} className="space-y-4">
        {step === 1 && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <div className="relative">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={showPassword ? "text" : "password"}
                  className="w-full border rounded px-3 py-2 pr-16 text-sm"
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-600 hover:text-gray-800"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                At least 8 chars, mix of cases, number or symbol.
              </p>
              {stepError && (
                <div className="text-xs text-red-600 mt-1">{stepError}</div>
              )}
            </div>
          </>
        )}
        {step === 2 && (
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Avatar (optional)
            </label>
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
        )}
        {showCrop && avatarFile && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded shadow-lg w-full max-w-md p-4 space-y-3">
              <div className="relative w-full h-64 bg-black/5 rounded">
                <Cropper
                  image={previewUrl}
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
        {error && (
          <div className="text-xs text-red-600" role="alert">
            {error}
          </div>
        )}
        {step === 1 && username.trim() && password ? (
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded py-2 text-sm font-medium"
          >
            Continue
          </button>
        ) : null}
        {step === 2 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="w-1/2 border border-gray-300 hover:bg-gray-50 text-gray-800 rounded py-2 text-sm"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={loading || uploading}
              className="w-1/2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded py-2 text-sm font-medium"
            >
              {loading || uploading ? "Signing up…" : "Sign up"}
            </button>
          </div>
        )}
        <div className="text-center text-xs text-gray-600">
          Already have an account?{" "}
          <a className="text-blue-600" href="/login">
            Log in
          </a>
        </div>
      </form>
    </div>
  );
};
export default SignupPage;
