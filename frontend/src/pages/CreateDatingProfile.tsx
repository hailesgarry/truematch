import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CaretDown, MagnifyingGlass } from "phosphor-react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Field, { fieldControlClasses } from "../components/ui/Field";
import LocationPicker, {
  createEmptyLocationSelection,
  type LocationSelection,
} from "../components/common/LocationPicker";
import ActionButtons from "../components/ui/ActionButtons";
import { geocodeLocationSelection, type Coordinates } from "../lib/geocode";
import { Country, State, type ICountry, type IState } from "country-state-city";
import Modal from "../components/common/Modal";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { saveDatingProfile } from "../services/api";
import type { DatingProfile, DatingProfileUpsert, GeoLocation } from "../types";
import { datingProfilesKey } from "../hooks/useDatingProfilesQuery";
import { broadcastMessage } from "../lib/broadcast";

const STEPS = ["Basic info", "Location", "Preferences"] as const;
const GENDER_OPTIONS = ["Female", "Male"] as const;
const MATCH_GENDER_OPTIONS = [
  { label: "Women", value: "Female" },
  { label: "Men", value: "Male" },
  { label: "Everyone", value: "Everyone" },
] as const;

type BasicInfoState = {
  firstName: string;
  age: string;
  gender: string;
  interestedIn: string;
};

type CreateProfileInput = {
  userId: string;
  username?: string;
  firstName: string;
  ageNumber?: number;
  gender: string;
  interestedIn: string;
  location: LocationSelection;
  coordinates: Coordinates | null;
};

type CreateDatingProfileProps = {
  hideCancel?: boolean;
};

const CreateDatingProfile: React.FC<CreateDatingProfileProps> = ({
  hideCancel = false,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useUiStore((s) => s.showToast);
  const { userId, username, joined } = useAuthStore();

  const [step, setStep] = useState(0);
  const [basicInfo, setBasicInfo] = useState<BasicInfoState>(() => ({
    firstName: username ?? "",
    age: "",
    gender: "",
    interestedIn: "",
  }));
  const [location, setLocation] = useState<LocationSelection>(() =>
    createEmptyLocationSelection()
  );
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isCountryModalOpen, setIsCountryModalOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [isStateModalOpen, setIsStateModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGenderModalOpen, setIsGenderModalOpen] = useState(false);
  const [isInterestedModalOpen, setIsInterestedModalOpen] = useState(false);
  const [geocodeWarning, setGeocodeWarning] = useState<string | null>(null);

  const firstNameFieldId = useId();
  const ageFieldId = useId();
  const genderFieldId = useId();
  const interestedFieldId = useId();
  const [countries] = useState<ICountry[]>(() => Country.getAllCountries());
  const [focusedCountryIndex, setFocusedCountryIndex] = useState(0);
  const countrySelectRef = useRef<((country: ICountry | null) => void) | null>(
    null
  );
  const stateSelectRef = useRef<((state: IState | null) => void) | null>(null);
  const [focusedStateIndex, setFocusedStateIndex] = useState(0);
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
    if (joined === false) {
      navigate("/", { replace: true });
    }
  }, [joined, navigate]);

  useEffect(() => {
    setBasicInfo((prev) => {
      const nextName = username ?? "";
      if (!nextName) {
        return prev;
      }
      if (prev.firstName.trim().length > 0 && prev.firstName !== nextName) {
        return prev;
      }
      if (prev.firstName === nextName) {
        return prev;
      }
      return {
        ...prev,
        firstName: nextName,
      };
    });
  }, [username]);
  const ageNumber = useMemo(() => {
    const parsed = Number.parseInt(basicInfo.age, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [basicInfo.age]);

  const interestedValue = basicInfo.interestedIn.trim();
  const selectedInterestedOption = useMemo(
    () =>
      MATCH_GENDER_OPTIONS.find(
        (option) => option.value.toLowerCase() === interestedValue.toLowerCase()
      ) || null,
    [interestedValue]
  );
  const genderSelection = basicInfo.gender.trim();
  const interestedSelection = selectedInterestedOption?.label ?? "";
  const hasGenderSelection = genderSelection.length > 0;
  const hasInterestedSelection = interestedSelection.length > 0;

  const isAgeValid =
    typeof ageNumber === "number" && ageNumber >= 18 && ageNumber <= 99;
  const canProceedBasic =
    basicInfo.firstName.trim().length > 0 && isAgeValid && hasGenderSelection;
  const hasStateSelection = Boolean(
    location.stateCode || location.stateName.trim().length > 0
  );
  const canProceedLocation = Boolean(location.countryCode) && hasStateSelection;

  const mutation = useMutation<DatingProfile, unknown, CreateProfileInput>({
    mutationFn: async ({
      userId: userIdInput,
      firstName,
      ageNumber: ageValue,
      gender,
      interestedIn,
      location: loc,
      coordinates,
    }) => {
      const normalizedUserId = userIdInput.trim();
      if (!normalizedUserId) {
        throw new Error("userId required");
      }
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

      if (locationPayload && coordinates) {
        locationPayload.lat = coordinates.latitude;
        locationPayload.lon = coordinates.longitude;
      }

      const profilePayload: DatingProfileUpsert = {
        userId: normalizedUserId,
      };

      if (gender.trim()) {
        profilePayload.gender = gender;
      }

      if (typeof ageValue === "number") {
        profilePayload.age = ageValue;
      }

      if (locationPayload !== null) {
        profilePayload.location = locationPayload;
      }

      const trimmedFirstName = firstName.trim();
      if (trimmedFirstName) {
        profilePayload.firstName = trimmedFirstName;
      }

      if (interestedIn.trim()) {
        profilePayload.interestedIn = interestedIn.trim();
      }

      const saved = await saveDatingProfile(profilePayload);

      return saved;
    },
    onSuccess: async (_profile, variables) => {
      showToast("Your dating profile is live!", 3000);
      const tasks: Promise<unknown>[] = [
        queryClient.invalidateQueries({
          queryKey: ["datingProfile", variables.userId],
        }),
        queryClient.invalidateQueries({ queryKey: datingProfilesKey }),
      ];
      if (variables.username) {
        tasks.push(
          queryClient.invalidateQueries({
            queryKey: ["datingProfile", variables.username],
          })
        );
      }
      await Promise.all(tasks);
      broadcastMessage("tm:dating", { type: "dating:invalidate" });
      navigate("/onboarding", { replace: true });
    },
    onError: (err) => {
      const message =
        (err as any)?.response?.data?.detail ||
        (err instanceof Error ? err.message : undefined) ||
        "We couldn't save your profile. Try again.";
      showToast(message, 3000);
    },
  });

  const isSubmitting = mutation.isPending;
  const isBusy = isSubmitting || isGeocoding;
  const primaryHidden = (() => {
    if (isBusy) return false;
    if (step === 0) return !canProceedBasic;
    if (step === 1) return !canProceedLocation;
    if (step === 2) return !interestedValue.length;
    return false;
  })();

  const primaryDisabled = isBusy;
  const primaryLabel = (() => {
    if (step !== STEPS.length - 1) return "Next";
    if (isGeocoding) return "Finding your location...";
    if (isSubmitting) return "Creating profile...";
    return "Create profile";
  })();

  const handleStepSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    setError(null);
    setGeocodeWarning(null);

    if (step === 0) {
      if (!canProceedBasic) {
        setError("Please complete all required details to continue.");
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

    if (!interestedValue.length) {
      setError("Tell us who you want to match with to continue.");
      return;
    }

    if (!userId) {
      setError("Sign in to create your dating profile.");
      showToast("Sign in to continue", 2500);
      return;
    }

    let coordinates: Coordinates | null = null;
    if (location.countryCode) {
      setIsGeocoding(true);
      try {
        coordinates = await geocodeLocationSelection(location);
        if (!coordinates) {
          setGeocodeWarning(
            "We saved your location without exact coordinates. Distance accuracy may vary."
          );
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("[dating] failed to geocode location", err);
        }
        setGeocodeWarning(
          "We couldn't confirm that location. Distance may be less accurate."
        );
      } finally {
        setIsGeocoding(false);
      }
    }

    try {
      await mutation.mutateAsync({
        userId,
        username,
        firstName: basicInfo.firstName.trim(),
        ageNumber,
        gender: basicInfo.gender,
        interestedIn: basicInfo.interestedIn,
        location,
        coordinates,
      });
    } catch (err) {
      const message =
        (err as any)?.response?.data?.detail ||
        (err instanceof Error ? err.message : undefined) ||
        "Something went wrong while creating your profile.";
      setError(message);
    }
  };

  const handleBack = () => {
    if (step === 0 || isSubmitting || isGeocoding) return;
    setError(null);
    setStep((prev) => Math.max(0, prev - 1));
  };

  const handleCancel = () => {
    if (isSubmitting || isGeocoding) return;
    navigate("/");
  };

  const handleSelectGender = (value: string) => {
    setError(null);
    setBasicInfo((prev) => ({
      ...prev,
      gender: value,
    }));
    setIsGenderModalOpen(false);
  };

  const handleSelectInterested = (value: string) => {
    setError(null);
    setBasicInfo((prev) => ({
      ...prev,
      interestedIn: value,
    }));
    setIsInterestedModalOpen(false);
  };

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

  return (
    <div className="flex min-h-screen items-center bg-white">
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <p className="text-sm text-gray-600">
          Complete three quick steps to start matching.
        </p>

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

        <form onSubmit={handleStepSubmit} className="mt-10 space-y-8">
          {step === 0 ? (
            <div className="space-y-6">
              <Field
                label="First name"
                htmlFor={firstNameFieldId}
                required
                hint="This is how other members will see your name."
              >
                <input
                  id={firstNameFieldId}
                  type="text"
                  autoComplete="given-name"
                  maxLength={80}
                  className={fieldControlClasses}
                  placeholder="Enter your first name"
                  value={basicInfo.firstName}
                  onChange={(event) => {
                    setError(null);
                    setBasicInfo((prev) => ({
                      ...prev,
                      firstName: event.target.value,
                    }));
                  }}
                  disabled={isSubmitting}
                />
              </Field>

              <Field
                label="Age"
                htmlFor={ageFieldId}
                hint="You must be at least 18 years old."
                required
              >
                <input
                  id={ageFieldId}
                  type="number"
                  min={18}
                  max={99}
                  className={fieldControlClasses}
                  placeholder="Enter your age"
                  value={basicInfo.age}
                  onChange={(event) => {
                    setError(null);
                    setBasicInfo((prev) => ({
                      ...prev,
                      age: event.target.value,
                    }));
                  }}
                  disabled={isSubmitting}
                />
              </Field>

              <Field label="Gender" htmlFor={genderFieldId} required>
                <button
                  type="button"
                  id={genderFieldId}
                  onClick={() => {
                    if (isSubmitting) return;
                    setIsGenderModalOpen(true);
                  }}
                  className={`${fieldControlClasses} flex items-center justify-between bg-white text-left disabled:cursor-not-allowed`}
                  aria-haspopup="dialog"
                  aria-expanded={isGenderModalOpen}
                  disabled={isSubmitting}
                >
                  <span
                    className={clsx(
                      "flex-1 min-w-0 text-left",
                      hasGenderSelection
                        ? "text-gray-900"
                        : "italic text-gray-400"
                    )}
                  >
                    {hasGenderSelection
                      ? genderSelection
                      : "Select your gender"}
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

          {step === 1 ? (
            <div className="space-y-6">
              <p className="text-sm text-gray-600">
                Where you live helps us surface matches near you.
              </p>
              <LocationPicker
                value={location}
                onChange={(value) => {
                  setError(null);
                  setGeocodeWarning(null);
                  setLocation(value);
                }}
                countryLabel="Where do you live?"
                countryPlaceholder="Choose your country"
                statePlaceholder="Choose your state or province"
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
              <p className="text-sm text-gray-600">
                Tell us who you'd like to match with.
              </p>
              <Field
                label="I am interested in"
                htmlFor={interestedFieldId}
                hint="This helps us show better matches."
                required
              >
                <button
                  type="button"
                  id={interestedFieldId}
                  onClick={() => {
                    if (isSubmitting) return;
                    setIsInterestedModalOpen(true);
                  }}
                  className={`${fieldControlClasses} flex items-center justify-between bg-white text-left disabled:cursor-not-allowed`}
                  aria-haspopup="dialog"
                  aria-expanded={isInterestedModalOpen}
                  disabled={isSubmitting}
                >
                  <span
                    className={clsx(
                      "flex-1 min-w-0 text-left",
                      hasInterestedSelection
                        ? "text-gray-900"
                        : "italic text-gray-400"
                    )}
                  >
                    {hasInterestedSelection
                      ? interestedSelection
                      : "Who are you interested in?"}
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

          {error ? (
            <div className="rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          ) : null}

          {geocodeWarning ? (
            <div className="rounded-md border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {geocodeWarning}
            </div>
          ) : null}

          <ActionButtons
            variant="double"
            secondaryText={
              step > 0 ? "Back" : hideCancel ? undefined : "Cancel"
            }
            onSecondary={
              step > 0 ? handleBack : hideCancel ? undefined : handleCancel
            }
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
          isOpen={isGenderModalOpen}
          onClose={() => setIsGenderModalOpen(false)}
          title="Select gender"
          size="sm"
          closeOnOverlayClick
        >
          <fieldset className="space-y-1" role="radiogroup">
            <legend className="sr-only">Gender options</legend>
            {GENDER_OPTIONS.map((option, index) => {
              const isActive =
                genderSelection.length > 0 &&
                genderSelection.toLowerCase() === option.toLowerCase();
              return (
                <label
                  key={option}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <input
                    type="radio"
                    name="gender-option"
                    value={option}
                    checked={isActive}
                    onChange={() => handleSelectGender(option)}
                    className="h-4 w-4 accent-red-500"
                    data-autofocus={index === 0 ? true : undefined}
                    disabled={isSubmitting}
                  />
                  <span
                    className={
                      isActive ? "font-semibold text-gray-900" : "text-gray-900"
                    }
                  >
                    {option}
                  </span>
                </label>
              );
            })}
          </fieldset>
        </Modal>

        <Modal
          isOpen={isInterestedModalOpen}
          onClose={() => setIsInterestedModalOpen(false)}
          title="Who are you interested in?"
          size="sm"
          closeOnOverlayClick
        >
          <fieldset className="space-y-1" role="radiogroup">
            <legend className="sr-only">Match preference options</legend>
            {MATCH_GENDER_OPTIONS.map((option, index) => {
              const isActive =
                interestedValue.length > 0 &&
                interestedValue.toLowerCase() === option.value.toLowerCase();
              return (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <input
                    type="radio"
                    name="interested-option"
                    value={option.value}
                    checked={isActive}
                    onChange={() => handleSelectInterested(option.value)}
                    className="h-4 w-4 accent-red-500"
                    data-autofocus={index === 0 ? true : undefined}
                    disabled={isSubmitting}
                  />
                  <span
                    className={
                      isActive ? "font-semibold text-gray-900" : "text-gray-900"
                    }
                  >
                    {option.label}
                  </span>
                </label>
              );
            })}
          </fieldset>
        </Modal>
      </div>
    </div>
  );
};

export default CreateDatingProfile;
