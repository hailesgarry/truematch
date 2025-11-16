import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import { CaretDown, CheckCircle, MagnifyingGlass, Plus } from "phosphor-react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Field, { fieldControlClasses } from "../components/ui/Field";
import RangeSlider from "../components/ui/RangeSlider";
import LocationPicker, {
  createEmptyLocationSelection,
  type LocationSelection,
} from "../components/common/LocationPicker";
import ActionButtons from "../components/ui/ActionButtons";
import { Country, State, type ICountry, type IState } from "country-state-city";
import Modal from "../components/common/Modal";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { saveDatingProfile, uploadDatingPhoto } from "../services/api";
import type { DatingProfile, DatingProfileUpsert, GeoLocation } from "../types";
import {
  RELATIONSHIP_OPTIONS,
  normalizeRelationship,
  toCanonicalRelationshipList,
} from "../utils/relationshipPreferences";
import { datingProfilesKey } from "../hooks/useDatingProfilesQuery";
import { broadcastMessage } from "../lib/broadcast";

const STEPS = [
  "Add photo",
  "Location",
  "Relationship",
  "Profile heading",
  "Age range",
] as const;
const MIN_AGE = 18;
const MAX_AGE = 70;
type SelectedPhoto = {
  id: string;
  file: File;
  previewUrl: string;
};

type CreateProfileInput = {
  userId: string;
  username?: string;
  relationshipLookingFor: string[];
  location: LocationSelection;
  photos: SelectedPhoto[];
  agePreference: {
    min: number;
    max: number;
  };
  profileHeading?: string;
  interestedIn?: string;
};

const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);
  const { userId, username } = useAuthStore();

  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [location, setLocation] = useState<LocationSelection>(() =>
    createEmptyLocationSelection()
  );
  const [relationshipOptions, setRelationshipOptions] = useState<string[]>([]);
  const [agePreference, setAgePreference] = useState({ min: 24, max: 40 });
  const [profileHeading, setProfileHeading] = useState("");
  const [isCountryModalOpen, setIsCountryModalOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [isStateModalOpen, setIsStateModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [isRelationshipModalOpen, setIsRelationshipModalOpen] = useState(false);

  const relationshipFieldId = useId();
  const profileHeadingFieldId = useId();
  const photosFieldId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [countries] = useState<ICountry[]>(() => Country.getAllCountries());
  const [focusedCountryIndex, setFocusedCountryIndex] = useState(0);
  const countrySelectRef = useRef<((country: ICountry | null) => void) | null>(
    null
  );
  const stateSelectRef = useRef<((state: IState | null) => void) | null>(null);
  const [focusedStateIndex, setFocusedStateIndex] = useState(0);
  const ageRangeFieldId = useId();
  const ageRangeLabelId = `${ageRangeFieldId}-label`;
  const filteredCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    if (!query) return countries;
    return countries.filter((country) =>
      country.name.toLowerCase().includes(query)
    );
  }, [countries, countrySearch]);
  const states = useMemo<IState[]>(() => {
    if (!location.countryCode) return [];
    return State.getStatesOfCountry(location.countryCode) as IState[];
  }, [location.countryCode]);

  useEffect(() => {
    return () => {
      photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    };
  }, [photos]);

  useEffect(() => {
    setFocusedCountryIndex((current) => {
      if (!filteredCountries.length) return 0;
      return Math.min(current, filteredCountries.length - 1);
    });
  }, [filteredCountries]);

  useEffect(() => {
    setFocusedStateIndex((current) => {
      if (!states.length) return 0;
      return Math.min(current, states.length - 1);
    });
  }, [states.length]);

  useEffect(() => {
    if (!states.length) {
      setIsStateModalOpen(false);
    }
  }, [states.length]);

  const hasRelationshipSelection = relationshipOptions.length > 0;
  const relationshipSummary = hasRelationshipSelection
    ? relationshipOptions.join(", ")
    : "Select one or more options";
  const trimmedProfileHeading = profileHeading.trim();
  const hasPhotos = photos.length > 0;
  const hasStateSelection = Boolean(
    location.stateCode || location.stateName.trim().length > 0
  );
  const canProceedLocation = Boolean(location.countryCode) && hasStateSelection;
  const agePreferenceValid =
    agePreference.min >= 18 &&
    agePreference.max <= 70 &&
    agePreference.min <= agePreference.max;

  const mutation = useMutation<DatingProfile, unknown, CreateProfileInput>({
    mutationFn: async ({
      userId: userIdInput,
      username: user,
      relationshipLookingFor,
      location: loc,
      photos: selectedPhotos,
      agePreference: preference,
      profileHeading = "",
      interestedIn: matchPreference = "",
    }) => {
      const normalizedUserId = userIdInput.trim();
      if (!normalizedUserId) {
        throw new Error("userId required");
      }
      const normalizedUsername = (user ?? "").trim();
      if (!normalizedUsername) {
        throw new Error("username required for photo upload");
      }
      const uploadedUrls: string[] = [];
      for (let index = 0; index < selectedPhotos.length; index += 1) {
        const item = selectedPhotos[index];
        setUploadStatus(
          `Uploading photo ${index + 1} of ${selectedPhotos.length}...`
        );
        const { url } = await uploadDatingPhoto(item.file, normalizedUsername);
        uploadedUrls.push(url);
      }

      setUploadStatus("Saving your profile...");

      const formattedLocation = [loc.cityName, loc.stateName, loc.countryName]
        .filter(Boolean)
        .join(", ");
      const locationPayload: GeoLocation | null = loc.countryCode
        ? {
            city: loc.cityName || undefined,
            state: loc.stateName || undefined,
            stateCode: loc.stateCode || undefined,
            country: loc.countryName || loc.countryCode || undefined,
            countryCode: loc.countryCode || undefined,
            formatted: formattedLocation || undefined,
          }
        : null;

      const profilePayload: DatingProfileUpsert = {
        userId: normalizedUserId,
      };

      if (uploadedUrls.length) {
        const [primary, ...gallery] = uploadedUrls;
        profilePayload.photoUrl = primary;
        profilePayload.photo = primary;
        profilePayload.photos = gallery;
      }

      if (locationPayload !== null) {
        profilePayload.location = locationPayload;
      }

      if (matchPreference.trim()) {
        profilePayload.interestedIn = matchPreference.trim();
      }

      const canonicalRelationships = toCanonicalRelationshipList(
        relationshipLookingFor
      );
      if (canonicalRelationships.length) {
        profilePayload.relationshipLookingFor = canonicalRelationships;
        profilePayload.relationshipPreference = canonicalRelationships;
        profilePayload.relationshipsLookingFor = canonicalRelationships;
      }

      if (profileHeading.trim()) {
        profilePayload.mood = profileHeading.trim();
      }

      profilePayload.preferences = {
        ...(profilePayload.preferences || {}),
        age: {
          min: preference.min,
          max: preference.max,
        },
      };

      const saved = await saveDatingProfile(profilePayload);

      return saved;
    },
    onSuccess: async (_profile, variables) => {
      setUploadStatus(null);
      showToast("Looking good! Your profile is ready to go.", 3000);
      const invalidateTasks: Promise<unknown>[] = [
        queryClient.invalidateQueries({
          queryKey: ["datingProfile", variables.userId],
        }),
        queryClient.invalidateQueries({ queryKey: datingProfilesKey }),
      ];
      if (variables.username) {
        invalidateTasks.push(
          queryClient.invalidateQueries({
            queryKey: ["datingProfile", variables.username],
          })
        );
      }
      await Promise.all(invalidateTasks);
      broadcastMessage("tm:dating", { type: "dating:invalidate" });
      navigate("/dating", { replace: true });
    },
    onError: (err) => {
      setUploadStatus(null);
      const message =
        (err as any)?.response?.data?.detail ||
        (err instanceof Error ? err.message : undefined) ||
        "We couldn't save your profile. Try again.";
      showToast(message, 3000, "error");
    },
    onSettled: () => {
      setUploadStatus(null);
    },
  });

  const isSubmitting = mutation.isPending;
  const primaryHidden = (() => {
    if (isSubmitting) return false;
    if (step === 0) return !hasPhotos;
    if (step === 1) return !canProceedLocation;
    if (step === 2) return !hasRelationshipSelection;
    if (step === 3) return trimmedProfileHeading.length === 0;
    return false;
  })();

  const primaryDisabled = (() => {
    if (isSubmitting) return true;
    if (step === 4) return !agePreferenceValid;
    return false;
  })();
  const primaryLabel = (() => {
    if (step !== STEPS.length - 1) return "Next";
    if (isSubmitting) return "Finishing up...";
    return "Finish setup";
  })();

  const handlePhotoChange: React.ChangeEventHandler<HTMLInputElement> = (
    event
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    setError(null);

    const [primaryFile] = files;
    if (!primaryFile) return;

    setPhotos((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [
        {
          file: primaryFile,
          previewUrl: URL.createObjectURL(primaryFile),
          id: `${primaryFile.name}-${primaryFile.size}-${
            primaryFile.lastModified
          }-${Math.random().toString(36).slice(2)}`,
        },
      ];
    });

    event.target.value = "";
  };

  const handleAddPhotoClick = () => {
    if (isSubmitting) return;
    setError(null);
    fileInputRef.current?.click();
  };

  const handleRemovePhoto = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const toggleRelationshipOption = (option: string) => {
    const canonical = normalizeRelationship(option);
    if (!canonical) return;
    setError(null);
    setRelationshipOptions((prev) => {
      const exists = prev.some(
        (item) => item.toLowerCase() === canonical.toLowerCase()
      );
      const next = exists
        ? prev.filter((item) => item.toLowerCase() !== canonical.toLowerCase())
        : [...prev, canonical];
      return toCanonicalRelationshipList(next);
    });
  };

  const handleCloseRelationshipModal = () => {
    setIsRelationshipModalOpen(false);
  };

  const handleAgeRangeChange = useCallback(
    (value: [number, number]) => {
      setError(null);
      setAgePreference((prev) => {
        const [rawMin, rawMax] = value;
        const clampedMin = Math.min(Math.max(rawMin, MIN_AGE), MAX_AGE);
        const clampedMax = Math.min(Math.max(rawMax, MIN_AGE), MAX_AGE);
        const nextMin = Math.min(clampedMin, clampedMax);
        const nextMax = Math.max(clampedMin, clampedMax);
        if (prev.min === nextMin && prev.max === nextMax) {
          return prev;
        }
        return { min: nextMin, max: nextMax };
      });
    },
    [setAgePreference, setError]
  );

  const handleStepSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    setError(null);

    if (step === 0) {
      if (!hasPhotos) {
        setError("Add a photo to continue.");
        return;
      }
      setStep(1);
      return;
    }

    if (step === 1) {
      if (!canProceedLocation) {
        setError("Select your country and state to continue.");
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!hasRelationshipSelection) {
        setError("Select at least one relationship preference to continue.");
        return;
      }
      setStep(3);
      return;
    }

    if (step === 3) {
      setStep(4);
      return;
    }

    if (!agePreferenceValid) {
      setError("Choose an age range between 18 and 70 to continue.");
      return;
    }

    if (!userId || !username) {
      setError("Sign in to continue setting up your profile.");
      showToast("Sign in to continue", 2500);
      return;
    }

    try {
      await mutation.mutateAsync({
        userId,
        username,
        relationshipLookingFor:
          toCanonicalRelationshipList(relationshipOptions),
        location,
        photos,
        profileHeading: trimmedProfileHeading,
        agePreference,
      });
    } catch (err) {
      const message =
        (err as any)?.response?.data?.detail ||
        (err instanceof Error ? err.message : undefined) ||
        "Something went wrong while updating your profile.";
      setError(message);
    }
  };

  const handleBack = () => {
    if (step === 0 || isSubmitting) return;
    setError(null);
    setStep((prev) => Math.max(0, prev - 1));
  };

  const handleCountryPick = (country: ICountry | null) => {
    countrySelectRef.current?.(country);
    setIsCountryModalOpen(false);
  };

  const handleCountrySearchChange: React.ChangeEventHandler<
    HTMLInputElement
  > = (event) => {
    setCountrySearch(event.target.value);
    setFocusedCountryIndex(0);
  };

  const handleCountryListKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (
    event
  ) => {
    if (!filteredCountries.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedCountryIndex((index) =>
        index + 1 >= filteredCountries.length ? 0 : index + 1
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedCountryIndex((index) =>
        index - 1 < 0 ? filteredCountries.length - 1 : index - 1
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = filteredCountries[focusedCountryIndex];
      if (selected) {
        handleCountryPick(selected);
      }
    }
  };

  const handleStatePick = (state: IState | null) => {
    stateSelectRef.current?.(state);
    setIsStateModalOpen(false);
  };

  const handleStateListKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (
    event
  ) => {
    if (!states.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedStateIndex((index) =>
        index + 1 >= states.length ? 0 : index + 1
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedStateIndex((index) =>
        index - 1 < 0 ? states.length - 1 : index - 1
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = states[focusedStateIndex];
      if (selected) {
        handleStatePick(selected);
      }
    }
  };

  const stepIntro = useMemo(() => {
    switch (step) {
      case 0:
        return "Add a standout photo to make a great first impression.";
      case 1:
        return "Tell us where you'd like to find potential matches.";
      case 2:
        return "Tell us the relationship you're hoping to find.";
      case 3:
        return "Add a short headline that captures your vibe.";
      case 4:
        return "Choose the age range you usually match with.";
      default:
        return "Finish setting up your profile.";
    }
  }, [step]);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {step === 3 ? (
        <div className="sticky top-0 z-10 bg-white px-4 py-3">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-end">
            <button
              type="button"
              onClick={() => {
                if (isSubmitting) return;
                setProfileHeading("");
                setError(null);
                setStep(4);
              }}
              className="text-sm font-medium text-gray-500 transition hover:text-gray-700"
            >
              Skip
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 items-center">
        <div className="mx-auto w-full max-w-2xl px-4 py-10">
          <p className="text-sm text-gray-600">{stepIntro}</p>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">
              Step {step + 1} of {STEPS.length}
            </span>
            <div className="flex items-center gap-2" aria-hidden="true">
              {STEPS.map((_, index) => (
                <span
                  key={`progress-${index}`}
                  className={clsx(
                    "h-1 w-10 rounded-full bg-gray-200 transition-colors",
                    index <= step ? "bg-red-500" : "bg-gray-200"
                  )}
                />
              ))}
            </div>
          </div>

          <form onSubmit={handleStepSubmit} className="mt-6 space-y-8">
            {step === 0 ? (
              <div className="space-y-6">
                <Field label="Add a photo" htmlFor={photosFieldId} required>
                  <div className="space-y-4">
                    {hasPhotos ? (
                      photos.map((item) => (
                        <div
                          key={item.id}
                          className="relative aspect-square overflow-hidden rounded-2xl border border-gray-200 bg-gray-100"
                        >
                          <img
                            src={item.previewUrl}
                            alt="Selected dating profile photo"
                            className="h-full w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemovePhoto(item.id)}
                            className="absolute right-2 top-2 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-gray-700 shadow hover:bg-white"
                            disabled={isSubmitting}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    ) : (
                      <button
                        type="button"
                        onClick={handleAddPhotoClick}
                        className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50 text-gray-400 transition hover:border-gray-400 hover:text-gray-500 disabled:cursor-not-allowed"
                        disabled={isSubmitting}
                        aria-label="Add photo"
                      >
                        <Plus size={24} weight="bold" />
                        <span className="text-xs font-medium">Add photo</span>
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    id={photosFieldId}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoChange}
                    disabled={isSubmitting}
                  />
                </Field>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="space-y-6">
                <LocationPicker
                  value={location}
                  onChange={(value) => {
                    setError(null);
                    setLocation(value);
                  }}
                  countryLabel="Where do you want to find your match/partner?"
                  countryPlaceholder="Choose country"
                  statePlaceholder="Choose state or province"
                  countryRequired
                  stateRequired
                  renderCountryField={({
                    id,
                    value,
                    onSelect,
                    placeholder,
                    required,
                  }) => {
                    countrySelectRef.current = onSelect;
                    const hasSelection = Boolean(value.countryName);
                    return (
                      <button
                        type="button"
                        id={id}
                        onClick={() => {
                          setIsCountryModalOpen(true);
                          setCountrySearch("");
                          const currentIndex = countries.findIndex(
                            (country) => country.isoCode === value.countryCode
                          );
                          setFocusedCountryIndex(
                            currentIndex >= 0 ? currentIndex : 0
                          );
                        }}
                        className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
                        aria-required={required}
                      >
                        <span
                          className={clsx(
                            "flex-1 min-w-0 text-left",
                            hasSelection
                              ? "text-gray-900"
                              : "italic text-gray-400"
                          )}
                        >
                          {hasSelection ? value.countryName : placeholder}
                        </span>
                        <CaretDown
                          size={16}
                          className="ml-3 flex-none text-gray-500"
                          aria-hidden
                        />
                      </button>
                    );
                  }}
                  renderStateField={({
                    id,
                    value,
                    onSelect,
                    placeholder,
                    required,
                    states: stateOptions,
                    disabled,
                  }) => {
                    stateSelectRef.current = onSelect;
                    const hasSelection = Boolean(value.stateName);
                    return (
                      <button
                        type="button"
                        id={id}
                        onClick={() => {
                          if (isSubmitting) return;
                          if (!stateOptions.length) return;
                          setIsStateModalOpen(true);
                          const currentIndex = stateOptions.findIndex(
                            (state) => state.isoCode === value.stateCode
                          );
                          setFocusedStateIndex(
                            currentIndex >= 0 ? currentIndex : 0
                          );
                        }}
                        className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
                        aria-haspopup="dialog"
                        aria-expanded={isStateModalOpen}
                        aria-required={required}
                        disabled={isSubmitting || disabled}
                      >
                        <span
                          className={clsx(
                            "flex-1 min-w-0 text-left",
                            hasSelection
                              ? "text-gray-900"
                              : "italic text-gray-400"
                          )}
                        >
                          {hasSelection ? value.stateName : placeholder}
                        </span>
                        <CaretDown
                          size={16}
                          className="ml-3 flex-none text-gray-500"
                          aria-hidden
                        />
                      </button>
                    );
                  }}
                />
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-6">
                <Field
                  label="Relationship you're looking for"
                  htmlFor={relationshipFieldId}
                  hint="Select one or more to help us tailor introductions."
                  required
                >
                  <button
                    type="button"
                    id={relationshipFieldId}
                    onClick={() => {
                      if (isSubmitting) return;
                      setError(null);
                      setIsRelationshipModalOpen(true);
                    }}
                    className={`${fieldControlClasses} flex items-center justify-between bg-white text-left disabled:cursor-not-allowed`}
                    aria-haspopup="dialog"
                    aria-expanded={isRelationshipModalOpen}
                    disabled={isSubmitting}
                  >
                    <span
                      className={clsx(
                        "flex-1 min-w-0 text-left",
                        hasRelationshipSelection
                          ? "text-gray-900"
                          : "italic text-gray-400"
                      )}
                    >
                      {relationshipSummary}
                    </span>
                    <CaretDown
                      size={16}
                      className="ml-3 flex-none text-gray-500"
                      aria-hidden
                    />
                  </button>
                </Field>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-6">
                <Field
                  label="Your profile heading"
                  htmlFor={profileHeadingFieldId}
                  hint="Share a short line that captures you at a glance."
                >
                  <textarea
                    id={profileHeadingFieldId}
                    rows={3}
                    className={`${fieldControlClasses} resize-none`}
                    placeholder="Describe yourself in one catchy sentence"
                    value={profileHeading}
                    onChange={(event) => {
                      setError(null);
                      setProfileHeading(event.target.value);
                    }}
                    maxLength={140}
                  />
                </Field>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-6">
                <Field
                  label="Preferred dating age range"
                  hint="Pick the range of ages you usually match with."
                  htmlFor={ageRangeFieldId}
                  required
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-sm font-medium text-gray-900">
                      <span>{agePreference.min}</span>
                      <span className="text-xs font-normal uppercase tracking-wide text-gray-400">
                        preferred ages
                      </span>
                      <span>{agePreference.max}</span>
                    </div>
                    <RangeSlider
                      id={ageRangeFieldId}
                      min={MIN_AGE}
                      max={MAX_AGE}
                      step={1}
                      value={[agePreference.min, agePreference.max]}
                      onValueChange={handleAgeRangeChange}
                      ariaLabels={[
                        "Minimum preferred age",
                        "Maximum preferred age",
                      ]}
                      ariaLabelledBy={ageRangeLabelId}
                      className="pt-1"
                      trackClassName="bg-gray-200"
                    />
                  </div>
                </Field>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            ) : null}

            {uploadStatus ? (
              <div className="rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-600">
                {uploadStatus}
              </div>
            ) : null}

            <ActionButtons
              variant="double"
              secondaryText={step > 0 ? "Back" : undefined}
              onSecondary={step > 0 ? handleBack : undefined}
              secondaryType="button"
              secondaryDisabled={step > 0 ? isSubmitting : false}
              primaryText={primaryLabel}
              primaryType="submit"
              primaryDisabled={primaryDisabled}
              hidePrimary={primaryHidden}
              className="w-full justify-between"
              stretchButtons={false}
              size="sm"
            />
          </form>

          <Modal
            isOpen={isCountryModalOpen}
            onClose={() => setIsCountryModalOpen(false)}
            title="Choose your country"
            size="md"
            closeOnOverlayClick
          >
            <div className="space-y-4">
              <div className="relative">
                <MagnifyingGlass
                  size={16}
                  weight="bold"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={countrySearch}
                  onChange={handleCountrySearchChange}
                  placeholder="Search countries"
                  className="w-full rounded-md border border-gray-200 px-3 py-3 pl-10 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:bg-gray-100"
                  data-autofocus
                />
              </div>
              <div
                role="listbox"
                tabIndex={0}
                onKeyDown={handleCountryListKeyDown}
                className="max-h-96 overflow-y-auto rounded-lg border border-gray-200"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {filteredCountries.length ? (
                  filteredCountries.map((country, index) => {
                    const isActive = country.isoCode === location.countryCode;
                    const isFocused = index === focusedCountryIndex;
                    return (
                      <button
                        key={country.isoCode}
                        type="button"
                        onClick={() => handleCountryPick(country)}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setFocusedCountryIndex(index)}
                        className={clsx(
                          "flex w-full items-center justify-between px-4 py-2 text-left text-sm transition",
                          isFocused ? "bg-gray-100" : "hover:bg-gray-50",
                          isActive
                            ? "font-semibold text-gray-900"
                            : "text-gray-700"
                        )}
                      >
                        <span>{country.name}</span>
                        {isActive ? (
                          <span className="text-xs text-red-500">Selected</span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <p className="px-4 py-6 text-center text-sm text-gray-500">
                    No countries match your search.
                  </p>
                )}
              </div>
            </div>
          </Modal>

          <Modal
            isOpen={isStateModalOpen}
            onClose={() => setIsStateModalOpen(false)}
            title="Choose your state or province"
            size="md"
            closeOnOverlayClick
          >
            <div className="space-y-4">
              <div
                role="listbox"
                tabIndex={0}
                onKeyDown={handleStateListKeyDown}
                className="max-h-96 overflow-y-auto rounded-lg border border-gray-100"
                data-autofocus
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {states.length ? (
                  states.map((state, index) => {
                    const isActive = state.isoCode === location.stateCode;
                    const isFocused = index === focusedStateIndex;
                    return (
                      <button
                        key={state.isoCode || state.name}
                        type="button"
                        onClick={() => handleStatePick(state)}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setFocusedStateIndex(index)}
                        className={clsx(
                          "flex w-full items-center justify-between px-4 py-2 text-left text-sm transition",
                          isFocused ? "bg-gray-100" : "hover:bg-gray-50",
                          isActive
                            ? "font-semibold text-gray-900"
                            : "text-gray-700"
                        )}
                      >
                        <span>{state.name}</span>
                        {isActive ? (
                          <span className="text-xs text-red-500">Selected</span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <p className="px-4 py-6 text-center text-sm text-gray-500">
                    No states are available for this country.
                  </p>
                )}
              </div>
            </div>
          </Modal>

          <Modal
            isOpen={isRelationshipModalOpen}
            onClose={handleCloseRelationshipModal}
            title="Select relationship preference"
            size="sm"
            closeOnOverlayClick
          >
            <div
              className="space-y-1"
              role="group"
              aria-label="Relationship preference"
            >
              {RELATIONSHIP_OPTIONS.map((option, index) => {
                const isActive = relationshipOptions.some(
                  (item) => item.toLowerCase() === option.toLowerCase()
                );
                return (
                  <label
                    key={option}
                    className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm text-gray-900 transition-colors hover:bg-gray-50"
                  >
                    <span>{option}</span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isActive}
                      onChange={() => toggleRelationshipOption(option)}
                      data-autofocus={index === 0 ? true : undefined}
                      disabled={isSubmitting}
                    />
                    <CheckCircle
                      size={16}
                      weight={isActive ? "fill" : "regular"}
                      className={isActive ? "text-red-500" : "text-gray-900"}
                      aria-hidden
                    />
                  </label>
                );
              })}
            </div>
          </Modal>
        </div>
      </div>
    </div>
  );
};

export default OnboardingPage;
