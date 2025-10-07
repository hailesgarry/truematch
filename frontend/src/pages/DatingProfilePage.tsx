import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  UploadSimple,
  // Trash,                    // not used
  Crosshair,
  CaretDown,
  CaretLeft,
  CaretRight,
  X,
} from "phosphor-react";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { useDatingStore } from "../stores/datingStore";
import { saveDatingProfile, uploadDatingPhoto } from "../services/api";
import type { GeoLocation, DatingProfile } from "../types";
import BottomSheet from "../components/common/BottomSheet";

const MAX_MOOD = 50;
const MIN_AGE = 18;

const RELIGION_OPTIONS = [
  "Any", // for preferences
  "Christian",
  "Muslim",
  "Hindu",
  "Buddhist",
  "Jewish",
  "Atheist",
  "Other",
];

// NEW: headline options (professional short phrases)
const HEADLINE_OPTIONS = [
  "Looking for a relationship",
  "Open to a casual connection",
  "Seeking friendship",
  "Bored—looking to chat",
  "Looking for a serious relationship",
  "Just exploring",
];

// NEW: gender options
const GENDER_OPTIONS = ["Male", "Female"];

const DatingProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { username } = useAuthStore();
  const { showToast } = useUiStore();
  const { profile, setPhoto, setMood } = useDatingStore();

  // Wizard step
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Username (read-only), Age, Gender, Location
  const [age, setAge] = useState<number | "">(
    typeof profile?.age === "number" ? profile.age : ""
  );
  const [gender, setGender] = useState<string>(profile.gender || ""); // NEW
  const [localLocation, setLocalLocation] = useState<GeoLocation | null>(null);
  const [manualCity, setManualCity] = useState("");
  const [manualState, setManualState] = useState("");
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  // Step 2: Preferences (Headline + Religion + Preferred Age/Religion)
  const [localMood, setLocalMood] = useState(profile.mood || "");
  const [religion, setReligion] = useState<string>(profile.religion || "");
  const [prefAgeMin, setPrefAgeMin] = useState<number>(18);
  const [prefAgeMax, setPrefAgeMax] = useState<number>(60);
  const [prefReligions, setPrefReligions] = useState<string[]>(["Any"]);
  // Draft persistence (localStorage)
  const draftKey = `datingProfileWizardDraft:v1:${username || "anon"}`;
  const buildDraft = () => ({
    step,
    age,
    gender,
    manualCity,
    manualState,
    localLocation,
    localMood,
    religion,
    prefAgeMin,
    prefAgeMax,
    prefReligions,
    existingRemotePhotos,
  });
  const saveDraft = () => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(buildDraft()));
    } catch {}
  };
  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {}
  };
  const loadDraft = () => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d) return false;
      if (typeof d.step === "number") setStep(d.step as 1 | 2 | 3);
      if (typeof d.age === "number" || d.age === "") setAge(d.age);
      if (typeof d.gender === "string") setGender(d.gender);
      if (typeof d.manualCity === "string") setManualCity(d.manualCity);
      if (typeof d.manualState === "string") setManualState(d.manualState);
      if (d.localLocation) setLocalLocation(d.localLocation as GeoLocation);
      if (typeof d.localMood === "string") setLocalMood(d.localMood);
      if (typeof d.religion === "string") setReligion(d.religion);
      if (typeof d.prefAgeMin === "number") setPrefAgeMin(d.prefAgeMin);
      if (typeof d.prefAgeMax === "number") setPrefAgeMax(d.prefAgeMax);
      if (Array.isArray(d.prefReligions)) setPrefReligions(d.prefReligions);
      if (Array.isArray(d.existingRemotePhotos))
        setExistingRemotePhotos(d.existingRemotePhotos);
      return true;
    } catch {
      return false;
    }
  };
  useEffect(() => {
    loadDraft(); /* once */
  }, []);
  // Inline validation flags (only after attempting to proceed)
  const [attemptStep1, setAttemptStep1] = useState(false);
  const [attemptStep2, setAttemptStep2] = useState(false);

  // Step 3: Photos (multiple uploads)
  const initialPhotoUrl = useMemo<string | null>(() => {
    const p = profile?.photo || null;
    return p && /^https?:\/\//i.test(p) ? p : null;
  }, [profile?.photo]);

  const [existingRemotePhotos, setExistingRemotePhotos] = useState<string[]>(
    initialPhotoUrl ? [initialPhotoUrl] : []
  );
  // Debounced autosave draft when relevant fields change
  useEffect(() => {
    const t = setTimeout(saveDraft, 800);
    return () => clearTimeout(t);
  }, [
    step,
    age,
    gender,
    manualCity,
    manualState,
    localLocation,
    localMood,
    religion,
    prefAgeMin,
    prefAgeMax,
    prefReligions,
    existingRemotePhotos,
  ]);
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [localPreviews, setLocalPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Refs for inline validation scroll targets
  const ageRef = useRef<HTMLInputElement>(null);
  const genderBtnRef = useRef<HTMLButtonElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);
  const headlineBtnRef = useRef<HTMLButtonElement>(null);
  const prefAgeMinRef = useRef<HTMLInputElement>(null);
  const prefAgeMaxRef = useRef<HTMLInputElement>(null);

  const onPickFiles = () => fileInputRef.current?.click();

  const onFilesChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const files = Array.from(e.target.files || []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (!files.length) return;

    const readers = files.map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.readAsDataURL(file);
        })
    );

    Promise.all(readers).then((previews) => {
      setLocalFiles((prev) => [...prev, ...files]);
      setLocalPreviews((prev) => [...prev, ...previews]);
    });
  };

  const removeLocalPhotoAt = (idx: number) => {
    setLocalFiles((prev) => prev.filter((_, i) => i !== idx));
    setLocalPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const removeExistingPhotoAt = (idx: number) => {
    setExistingRemotePhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  // Geolocation
  const useCurrentLocation = async () => {
    setLocError(null);
    if (!("geolocation" in navigator)) {
      setLocError("Geolocation is not supported by this browser.");
      return;
    }
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        let city: string | undefined;
        let state: string | undefined;
        let country: string | undefined;
        let formatted: string | undefined;
        try {
          const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`;
          const res = await fetch(url, {
            headers: { Accept: "application/json" },
          });
          if (res.ok) {
            const data = await res.json();
            const addr = data?.address || {};
            city =
              addr.city ||
              addr.town ||
              addr.village ||
              addr.suburb ||
              addr.county;
            state = addr.state || addr.region;
            country = (addr.country_code || "")?.toUpperCase();
            const label = [city, state].filter(Boolean).join(", ");
            formatted = label || data?.display_name;
          }
        } catch {
          // ignore; user can fill manually
        } finally {
          setLocBusy(false);
        }

        setLocalLocation({
          lat: latitude,
          lon: longitude,
          accuracy,
          city,
          state,
          country,
          formatted,
        });
        if (city) setManualCity(city);
        if (state) setManualState(state || "");
      },
      (err) => {
        setLocBusy(false);
        setLocError(err?.message || "Unable to get current location.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  const canProceedFromStep1 = () => {
    const ageOk = typeof age === "number" && age >= MIN_AGE && age < 100;
    const genderOk = !!gender;
    let finalLocation: GeoLocation | null = localLocation;
    if (!finalLocation) {
      const city = manualCity.trim();
      const state = manualState.trim();
      if (city && state) {
        finalLocation = {
          lat: 0,
          lon: 0,
          city,
          state,
          formatted: `${city}, ${state}`,
        };
      }
    }
    return ageOk && genderOk && !!finalLocation;
  };

  const canProceedFromStep2 = () => {
    const hasHeadline = !!localMood;
    const moodOk = (localMood || "").length <= MAX_MOOD;
    const prefAgeOk =
      prefAgeMin >= 18 && prefAgeMax >= prefAgeMin && prefAgeMax <= 100;
    return hasHeadline && moodOk && prefAgeOk;
  };

  const goBack = () => setStep((s) => (s === 1 ? 1 : ((s - 1) as 1 | 2 | 3)));

  const goNext = () => {
    if (step === 1) {
      const ageOk = typeof age === "number" && age >= MIN_AGE && age < 100;
      const genderOk = !!gender;
      const hasGeo = !!localLocation;
      const hasManual = manualCity.trim() && manualState.trim();
      const locOk = !!(hasGeo || hasManual);
      if (!(ageOk && genderOk && locOk)) {
        setAttemptStep1(true);
        // Smooth scroll to first error
        if (!ageOk && ageRef.current) {
          ageRef.current.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } else if (!genderOk && genderBtnRef.current) {
          genderBtnRef.current.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } else if (!locOk && (cityRef.current || stateRef.current)) {
          (cityRef.current || stateRef.current)!.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
        return;
      }
      setAttemptStep1(false);
      setStep(2);
      return;
    }
    if (step === 2) {
      const hasHeadline = !!localMood;
      const prefOk =
        prefAgeMin >= 18 && prefAgeMax >= prefAgeMin && prefAgeMax <= 100;
      if (!(hasHeadline && prefOk)) {
        setAttemptStep2(true);
        if (!hasHeadline && headlineBtnRef.current) {
          headlineBtnRef.current.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } else if (
          !prefOk &&
          (prefAgeMinRef.current || prefAgeMaxRef.current)
        ) {
          (prefAgeMinRef.current || prefAgeMaxRef.current)!.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
        return;
      }
      setAttemptStep2(false);
      setStep(3);
      return;
    }
  };

  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (!username) {
        showToast("Please sign in first.");
        setAttemptStep2(false);
        setSaving(false);
        return;
      }
      if (!canProceedFromStep1() || !canProceedFromStep2()) {
        showToast("Please complete required fields.");
        setSaving(false);
        return;
      }

      // Prepare location
      let finalLocation: GeoLocation | null = localLocation;
      if (!finalLocation) {
        const city = manualCity.trim();
        const state = manualState.trim();
        if (city && state) {
          finalLocation = {
            lat: 0,
            lon: 0,
            city,
            state,
            formatted: `${city}, ${state}`,
          };
        }
      }

      // Upload any new photos; keep existing remote photos
      const uploadedUrls: string[] = [];
      for (const f of localFiles) {
        try {
          const res = await uploadDatingPhoto(f, username);
          uploadedUrls.push(res.url);
        } catch (e) {
          console.error("Photo upload failed:", e);
          showToast("One of the photos failed to upload. Try again.");
          return;
        }
      }
      const allPhotos: string[] = [...existingRemotePhotos, ...uploadedUrls];

      // Update local store for quick UI reflection (keep first as legacy)
      setPhoto(allPhotos[0] || null);
      setMood(localMood);

      // Persist
      const payload: DatingProfile = {
        username: username || "",
        photoUrl: allPhotos[0] || null, // legacy/fallback
        photos: allPhotos,
        mood: localMood,
        age: typeof age === "number" ? age : undefined,
        gender: gender || undefined, // NEW
        religion: religion || undefined,
        location: finalLocation,
        preferences: {
          age: { min: prefAgeMin, max: prefAgeMax },
          religions: prefReligions.length ? prefReligions : ["Any"],
        },
      };

      await saveDatingProfile(payload);
      clearDraft();
      showToast("Dating profile saved");
      try {
        sessionStorage.setItem("datingProfileCreated", "1");
      } catch {}
      navigate("/dating");
    } finally {
      setSaving(false);
    }
  };

  // Helpers for multi-select of preferred religions
  const togglePrefReligion = (value: string) => {
    if (value === "Any") {
      setPrefReligions(["Any"]);
      return;
    }
    setPrefReligions((prev) => {
      const next = new Set(prev.filter((v) => v !== "Any"));
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return Array.from(next);
    });
  };

  // NEW: BottomSheet for gender selection
  const [showGenderSheet, setShowGenderSheet] = useState(false);
  // NEW: BottomSheet for headline selection
  const [showHeadlineSheet, setShowHeadlineSheet] = useState(false);
  // removed: BottomSheet for religion selection (using chips instead)

  // NEW: Derive target noun for preference descriptions
  const targetNoun = useMemo(() => {
    if (gender === "Female") return "boy/man";
    if (gender === "Male") return "girl/woman";
    return "partner";
  }, [gender]);

  // Back bottom sheet
  const [showBackSheet, setShowBackSheet] = useState(false);

  return (
    <div className="flex flex-col min-h-[100dvh] overflow-y-auto bg-white pt-[calc(env(safe-area-inset-top)+56px)] pb-[env(safe-area-inset-bottom)]">
      {/* Page header (fixed, 56px) */}
      <div className="fixed inset-x-0 top-0 z-20 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/70 border-b h-14">
        <div className="max-w-md mx-auto w-full h-full px-3 flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowBackSheet(true)}
            className="text-gray-900"
            aria-label="Back"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="text-base font-semibold text-gray-900">
            Dating profile
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <div className="max-w-md mx-auto w-full px-4 py-6">
          {/* Stepper header */}
          <div className="flex items-center justify-between mb-6">
            <div className="text-sm font-medium">Step {step} of 3</div>
            <div className="flex items-center gap-2">
              <div
                className={`h-1 w-8 rounded ${
                  step >= 1 ? "bg-red-500" : "bg-gray-200"
                }`}
              />
              <div
                className={`h-1 w-8 rounded ${
                  step >= 2 ? "bg-red-500" : "bg-gray-200"
                }`}
              />
              <div
                className={`h-1 w-8 rounded ${
                  step >= 3 ? "bg-red-500" : "bg-gray-200"
                }`}
              />
            </div>
          </div>

          {step === 1 && (
            <>
              {/* Step 1 header */}
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Your basic details
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Confirm your username, add your age and gender, and set your
                  location.
                </p>
              </div>

              {/* Username */}
              <div className="mb-4">
                <label
                  htmlFor="username"
                  className="block text-sm font-medium text-gray-900 mb-1"
                >
                  Username
                </label>
                <input
                  type="text"
                  id="username"
                  value={username || ""}
                  readOnly
                  aria-readonly="true"
                  className="w-full rounded-md border border-gray-300 bg-gray-100 text-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-gray-300"
                />
                <p className="mt-1 text-xs text-gray-500">
                  This username is set from your account and cannot be edited
                  here.
                </p>
              </div>

              {/* Age (required) */}
              <div className="mb-6">
                <label
                  htmlFor="age"
                  className="block text-sm font-medium text-gray-900 mb-1"
                >
                  Age{" "}
                  <span className="text-red-600" aria-hidden>
                    *
                  </span>
                </label>
                <input
                  ref={ageRef}
                  type="number"
                  id="age"
                  min={MIN_AGE}
                  max={100}
                  value={age}
                  onChange={(e) =>
                    setAge(e.target.value ? Number(e.target.value) : "")
                  }
                  placeholder="Enter your age"
                  required
                  aria-required
                  aria-invalid={
                    attemptStep1 &&
                    !(typeof age === "number" && age >= MIN_AGE && age < 100)
                  }
                  className={[
                    "w-full rounded-md px-3 py-2 focus:outline-none focus:ring-2",
                    attemptStep1 &&
                    !(typeof age === "number" && age >= MIN_AGE && age < 100)
                      ? "border-red-500 ring-red-200 border"
                      : "border border-gray-300 focus:ring-red-500/20 focus:border-gray-300",
                  ].join(" ")}
                />
                <p className="mt-1 text-xs text-gray-500">
                  You must be at least {MIN_AGE}.
                </p>
                {attemptStep1 &&
                  !(typeof age === "number" && age >= MIN_AGE && age < 100) && (
                    <p className="mt-1 text-xs text-red-600">
                      Please enter a valid age (18+).
                    </p>
                  )}
              </div>

              {/* Gender (BottomSheet) - required */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-800 mb-1">
                  Gender{" "}
                  <span className="text-red-600" aria-hidden>
                    *
                  </span>
                </label>
                <button
                  type="button"
                  ref={genderBtnRef}
                  onClick={() => setShowGenderSheet(true)}
                  aria-required
                  aria-invalid={attemptStep1 && !gender}
                  className={[
                    "w-full flex items-center justify-between rounded-md px-3 py-2 focus:outline-none",
                    attemptStep1 && !gender
                      ? "border border-red-500 ring-1 ring-red-200 bg-white"
                      : "border border-gray-300 bg-white hover:bg-gray-50 focus:ring-2 focus:ring-red-500/20 focus:border-gray-300",
                  ].join(" ")}
                >
                  <span
                    className={
                      attemptStep1 && !gender ? "text-red-600" : "text-gray-900"
                    }
                  >
                    {gender || "Select gender"}
                  </span>
                  <CaretDown
                    size={16}
                    className={
                      attemptStep1 && !gender ? "text-red-500" : "text-gray-400"
                    }
                    aria-hidden="true"
                  />
                </button>
                {attemptStep1 && !gender && (
                  <p className="mt-1 text-xs text-red-600">
                    Please select your gender.
                  </p>
                )}
              </div>

              {/* Location (required) */}
              <fieldset className="mb-6">
                <legend className="block text-sm font-medium text-gray-900 mb-1">
                  Location{" "}
                  <span className="text-red-600" aria-hidden>
                    *
                  </span>
                </legend>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={useCurrentLocation}
                    disabled={locBusy}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-md ${
                      locBusy
                        ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                        : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                    }`}
                    aria-busy={locBusy}
                  >
                    <Crosshair size={18} />
                    {locBusy ? "Locating..." : "Use current location"}
                  </button>
                  {localLocation?.accuracy ? (
                    <span className="text-xs text-gray-500">
                      ±{Math.round(localLocation.accuracy)} m
                    </span>
                  ) : null}
                </div>
                {locError && (
                  <div className="text-xs text-red-600 mb-2">{locError}</div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="city"
                      className="block text-xs text-gray-900 mb-1"
                    >
                      City
                    </label>
                    <input
                      ref={cityRef}
                      type="text"
                      id="city"
                      value={manualCity}
                      onChange={(e) => setManualCity(e.target.value)}
                      placeholder="Enter your city (e.g., Yenegoa)"
                      aria-required
                      aria-invalid={
                        attemptStep1 && !localLocation && !manualCity.trim()
                      }
                      className={[
                        "w-full rounded-md px-3 py-2 placeholder:text-gray-400",
                        attemptStep1 && !localLocation && !manualCity.trim()
                          ? "border-red-500 ring-1 ring-red-200"
                          : "border border-gray-300",
                      ].join(" ")}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="state-region"
                      className="block text-xs text-gray-900 mb-1"
                    >
                      State or region
                    </label>
                    <input
                      ref={stateRef}
                      type="text"
                      id="state-region"
                      value={manualState}
                      onChange={(e) => setManualState(e.target.value)}
                      placeholder="Enter your state/region (e.g., Bayelsa)"
                      aria-required
                      aria-invalid={
                        attemptStep1 && !localLocation && !manualState.trim()
                      }
                      className={[
                        "w-full rounded-md px-3 py-2 placeholder:text-gray-400 focus:outline-none",
                        attemptStep1 && !localLocation && !manualState.trim()
                          ? "border-red-500 ring-1 ring-red-200"
                          : "border border-gray-300 focus:ring-2 focus:ring-red-500/20 focus:border-gray-300",
                      ].join(" ")}
                    />
                  </div>
                </div>

                {/* Removed the description below Location per request */}
                {attemptStep1 &&
                  (() => {
                    const hasGeo = !!localLocation;
                    const hasManual = manualCity.trim() && manualState.trim();
                    return !(hasGeo || hasManual);
                  })() && (
                    <p className="mt-2 text-xs text-red-600">
                      Please add your city and state, or use current location.
                    </p>
                  )}
              </fieldset>
            </>
          )}

          {step === 2 && (
            <>
              {/* Step 2 header */}
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Your preferences
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Choose a profile headline, optionally share your religion, and
                  set who you’d like to match with.
                </p>
              </div>

              {/* Headline (BottomSheet, required) */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  Profile headline{" "}
                  <span className="text-red-600" aria-hidden>
                    *
                  </span>
                </label>
                <button
                  ref={headlineBtnRef}
                  type="button"
                  onClick={() => setShowHeadlineSheet(true)}
                  className="w-full flex items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-gray-300"
                  aria-required
                  aria-invalid={attemptStep2 && !localMood}
                >
                  <span className="text-gray-900">
                    {localMood || "Select a headline"}
                  </span>
                  <CaretDown
                    size={16}
                    className="text-gray-400"
                    aria-hidden="true"
                  />
                </button>
                {attemptStep2 && !localMood && (
                  <p className="mt-1 text-xs text-red-600">
                    Please select a profile headline.
                  </p>
                )}
              </div>

              {/* Your religion (chips - single select, matches Preferred religion(s) UI) */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  Your religion
                </label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {/* Prefer not to say */}
                  <button
                    type="button"
                    aria-pressed={!religion}
                    onClick={() => setReligion("")}
                    className={[
                      "px-3 py-1.5 rounded-full text-sm border transition",
                      !religion
                        ? "bg-white text-red-600 border-red-500 ring-1 ring-red-300"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50",
                    ].join(" ")}
                  >
                    Prefer not to say
                  </button>
                  {RELIGION_OPTIONS.filter((r) => r !== "Any").map((r) => {
                    const selected = religion === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setReligion(r)}
                        className={[
                          "px-3 py-1.5 rounded-full text-sm border transition",
                          selected
                            ? "bg-white text-red-600 border-red-500 ring-1 ring-red-300"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50",
                        ].join(" ")}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Preferred age range */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  Preferred age range
                </label>
                <p className="mt-0.5 text-xs text-gray-500">
                  You want a {targetNoun} who is between the age of?
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <input
                    ref={prefAgeMinRef}
                    type="number"
                    min={18}
                    max={100}
                    value={prefAgeMin}
                    onChange={(e) =>
                      setPrefAgeMin(
                        Math.min(Number(e.target.value || 18), prefAgeMax)
                      )
                    }
                    className="w-24 rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-gray-300"
                  />
                  <span className="text-gray-500">to</span>
                  <input
                    ref={prefAgeMaxRef}
                    type="number"
                    min={prefAgeMin}
                    max={100}
                    value={prefAgeMax}
                    onChange={(e) =>
                      setPrefAgeMax(
                        Math.max(
                          Number(e.target.value || prefAgeMin),
                          prefAgeMin
                        )
                      )
                    }
                    className="w-24 rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-gray-300"
                  />
                </div>
                {attemptStep2 &&
                  !(
                    prefAgeMin >= 18 &&
                    prefAgeMax >= prefAgeMin &&
                    prefAgeMax <= 100
                  ) && (
                    <p className="mt-1 text-xs text-red-600">
                      Enter a valid age range.
                    </p>
                  )}
              </div>

              {/* Preferred religions */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  Preferred religion(s)
                </label>
                <p className="mt-0.5 text-xs text-gray-500">
                  You want a {targetNoun} who is a?
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {RELIGION_OPTIONS.map((r) => {
                    const selected = prefReligions.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => togglePrefReligion(r)}
                        className={[
                          "px-3 py-1.5 rounded-full text-sm border transition",
                          selected
                            ? "bg-white text-red-600 border-red-500 ring-1 ring-red-300"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50",
                        ].join(" ")}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Choose “Any” to match regardless of religion.
                </p>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              {/* Step 3 header */}
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Add your photos
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Upload clear photos. You can add multiple; the first one will
                  be used as your primary photo.
                </p>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Profile photos
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {existingRemotePhotos.map((url, i) => (
                    <div key={`remote-${i}`} className="relative">
                      <img
                        src={url}
                        alt={`Photo ${i + 1}`}
                        className="w-full h-24 object-cover rounded-md border"
                      />
                      <button
                        type="button"
                        onClick={() => removeExistingPhotoAt(i)}
                        className="absolute -top-2 -right-2 bg-white text-gray-700 border rounded-full p-1 shadow"
                        aria-label="Remove photo"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {localPreviews.map((src, i) => (
                    <div key={`local-${i}`} className="relative">
                      <img
                        src={src}
                        alt={`New photo ${i + 1}`}
                        className="w-full h-24 object-cover rounded-md border"
                      />
                      <button
                        type="button"
                        onClick={() => removeLocalPhotoAt(i)}
                        className="absolute -top-2 -right-2 bg-white text-gray-700 border rounded-full p-1 shadow"
                        aria-label="Remove photo"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4">
                  <button
                    type="button"
                    onClick={onPickFiles}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 text-gray-900 hover:bg-gray-200 transition-colors"
                  >
                    <UploadSimple size={18} />
                    {existingRemotePhotos.length > 0 || localPreviews.length > 0
                      ? "Add more photos"
                      : "Add photos"}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    id="profile-photos-input"
                    name="profilePhotos"
                    aria-hidden="true"
                    className="hidden"
                    onChange={onFilesChange}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  You can upload multiple photos. The first will be used as your
                  primary photo.
                </p>
              </div>
            </>
          )}

          {/* BottomSheets */}
          <BottomSheet
            isOpen={showGenderSheet}
            onClose={() => setShowGenderSheet(false)}
            title="Select gender"
          >
            <div
              className="divide-y divide-gray-200"
              role="radiogroup"
              aria-label="Gender"
            >
              {GENDER_OPTIONS.map((g) => {
                const selected = gender === g;
                return (
                  <button
                    key={g}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setGender(g);
                      setShowGenderSheet(false);
                    }}
                    className="w-full flex items-center justify-between py-3 text-left"
                  >
                    <span className="text-sm font-medium text-gray-800">
                      {g}
                    </span>
                    <span
                      className={[
                        "ml-3 inline-flex items-center justify-center w-4 h-4 rounded-full border",
                        selected ? "border-red-500" : "border-gray-400",
                      ].join(" ")}
                      aria-hidden="true"
                    >
                      <span
                        className={[
                          "w-2 h-2 rounded-full",
                          selected ? "bg-red-500" : "bg-transparent",
                        ].join(" ")}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </BottomSheet>

          <BottomSheet
            isOpen={showHeadlineSheet}
            onClose={() => setShowHeadlineSheet(false)}
            title="Select headline"
          >
            <div
              className="divide-y divide-gray-200"
              role="radiogroup"
              aria-label="Profile headline"
            >
              {HEADLINE_OPTIONS.map((opt) => {
                const selected = localMood === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setLocalMood(opt);
                      setShowHeadlineSheet(false);
                    }}
                    className="w-full flex items-center justify-between py-3 text-left"
                  >
                    <span className="text-sm font-medium text-gray-800">
                      {opt}
                    </span>
                    <span
                      className={[
                        "ml-3 inline-flex items-center justify-center w-4 h-4 rounded-full border",
                        selected ? "border-red-500" : "border-gray-400",
                      ].join(" ")}
                      aria-hidden="true"
                    >
                      <span
                        className={[
                          "w-2 h-2 rounded-full",
                          selected ? "bg-red-500" : "bg-transparent",
                        ].join(" ")}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </BottomSheet>

          {/* Religion BottomSheet removed; using chips UI above */}

          {/* Wizard navigation */}
          <div className="mt-6 flex items-center justify-between">
            {step > 1 ? (
              <button
                type="button"
                onClick={goBack}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border text-gray-700 border-gray-300 hover:bg-gray-50"
              >
                <CaretLeft size={18} />
                Back
              </button>
            ) : (
              <span />
            )}

            {step < 3 ? (
              <button
                type="button"
                onClick={goNext}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold shadow"
              >
                Next
                <CaretRight size={18} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSave}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold shadow"
                disabled={saving}
              >
                {saving ? "Creating..." : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="h-6" />

      {/* Back confirmation BottomSheet */}
      <BottomSheet
        isOpen={showBackSheet}
        onClose={() => setShowBackSheet(false)}
        title="Save your progress?"
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            You can save your current progress and continue later, or discard
            changes.
          </p>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => {
                saveDraft();
                setShowBackSheet(false);
                navigate(-1);
              }}
              className="w-full px-4 py-2 rounded-md bg-red-500 text-white hover:bg-red-600"
            >
              Save and go back
            </button>
            <button
              type="button"
              onClick={() => {
                clearDraft();
                setShowBackSheet(false);
                navigate(-1);
              }}
              className="w-full px-4 py-2 rounded-md bg-gray-100 text-gray-800 hover:bg-gray-200"
            >
              Discard changes
            </button>
            <button
              type="button"
              onClick={() => setShowBackSheet(false)}
              className="w-full px-4 py-2 rounded-md border text-gray-800 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};

export default DatingProfilePage;
