import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  CaretDown,
  CheckCircle,
  PencilSimple,
} from "phosphor-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Country, State, type ICountry, type IState } from "country-state-city";
import LocationPicker, {
  type LocationSelection,
  createEmptyLocationSelection,
} from "../../components/common/LocationPicker";
import Modal from "../../components/common/Modal";
import ActionButtons from "../../components/ui/ActionButtons";
import Field, { fieldControlClasses } from "../../components/ui/Field";
import FullscreenOverlay from "../../components/ui/FullscreenOverlay";
import SuccessToast from "../../components/ui/SuccessToast";
import { useAuthStore } from "../../stores/authStore";
import { useSocketStore } from "../../stores/socketStore";
import { useUiStore } from "../../stores/uiStore";
import { fetchDatingProfile, saveDatingProfile } from "../../services/api";
import {
  RELATIONSHIP_OPTIONS,
  normalizeRelationship,
  sortRelationshipOptions,
  toCanonicalRelationshipList,
} from "../../utils/relationshipPreferences";
import type {
  DatingProfile,
  DatingProfileUpsert,
  GeoLocation,
} from "../../types";
import { datingProfilesKey } from "../../hooks/useDatingProfilesQuery";
import { broadcastMessage } from "../../lib/broadcast";

type DatingProfilePatch = Partial<Omit<DatingProfileUpsert, "userId">>;

type ChildrenSelection = {
  choice: string;
  count: string;
};

type EditLivesInFormProps = {
  initialValue?: LocationSelection | null;
  onCancel: () => void;
  onSave: (value: LocationSelection) => void;
};

type EditGenderFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditAgeFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditHeightFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditBodyTypeFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditSmokingFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditDrinkingFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditChildrenFormProps = {
  initialValue?: ChildrenSelection | null;
  onCancel: () => void;
  onSave: (value: ChildrenSelection) => void;
};

type EditProfileHeadingFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditPartnerLookingForFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditFavoriteMovieFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditMusicPreferenceFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditFoodPreferenceFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditPerfectMatchFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditHobbyFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditWeekendActivityFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditTravelDestinationFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditFitnessActivityFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditRelocationFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditRelationshipFormProps = {
  initialValue?: string[] | null;
  onCancel: () => void;
  onSave: (value: string[]) => void;
};

type EditReligionFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditNationalityFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditEducationFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditFirstNameFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditJobTitleFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditCompanyFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditLifePhilosophyFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditCommunicationStyleFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditDatingProConFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditLoveLanguageFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditFirstDateFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditGreenFlagFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditRedFlagFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditSeekingForFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditSelfCareFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditSimplePleasuresFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

type EditGreatRelationshipFormProps = {
  initialValue?: string | null;
  onCancel: () => void;
  onSave: (value: string) => void;
};

const GENDER_OPTIONS = ["Male", "Female"] as const;
const HEIGHT_OPTIONS = [
  "Prefer not to say",
  "Under 3'",
  "3'0\"",
  "3'1\"",
  "3'2\"",
  "3'3\"",
  "3'4\"",
  "3'5\"",
  "3'6\"",
  "3'7\"",
  "3'8\"",
  "3'9\"",
  "3'10\"",
  "3'11\"",
  "4'0\"",
  "4'1\"",
  "4'2\"",
  "4'3\"",
  "4'4\"",
  "4'5\"",
  "4'6\"",
  "4'7\"",
  "4'8\"",
  "4'9\"",
  "4'10\"",
  "4'11\"",
  "5'0\"",
  "5'1\"",
  "5'2\"",
  "5'3\"",
  "5'4\"",
  "5'5\"",
  "5'6\"",
  "5'7\"",
  "5'8\"",
  "5'9\"",
  "5'10\"",
  "5'11\"",
  "6'0\"",
  "6'1\"",
  "6'2\"",
  "6'3\"",
  "6'4\"",
  "6'5\"",
  "6'6\"",
  "6'7\"",
  "6'8\"",
  "6'9\"",
  "6'10\"",
  "6'11\"",
  "7'0\"",
  "7'1\"",
  "7'2\"",
  "7'3\"",
  "7'4\"",
  "7'5\"",
  "7'6\"",
  "Over 7'6\"",
] as const;
const BODY_TYPE_OPTIONS = [
  "Prefer not to say",
  "Average",
  "Athletic",
  "Curvy",
  "Fit",
  "Full figured",
  "Heavyset",
  "Petite",
  "Plus size",
  "Slim",
  "Stocky",
] as const;
const SMOKING_OPTIONS = [
  "No",
  "Yes",
  "Yes, occasionally",
  "Prefer not to say",
] as const;
const DRINKING_OPTIONS = [
  "No",
  "Yes",
  "Yes, socially",
  "Prefer not to say",
] as const;
const CHILDREN_OPTIONS = [
  "No",
  "Yes, they live with me",
  "Yes, they don't live with me",
  "Prefer not to say",
] as const;
const RELOCATION_OPTIONS = [
  "Open to relocating",
  "Willing to relocate for the right person",
  "Not open to relocating",
  "Not sure yet",
] as const;
const RELIGION_OPTIONS = [
  "Buddhism",
  "Christianity",
  "Hinduism",
  "Islam",
  "Judaism",
  "Sikhism",
  "Spiritual but not religious",
  "Atheist",
  "Agnostic",
  "Other",
] as const;

const EDUCATION_OPTIONS = [
  "High school",
  "Some college",
  "Associate degree",
  "Bachelor's degree",
  "Graduate degree",
  "PhD",
  "Trade school",
  "Prefer not to say",
] as const;

const COMMUNICATION_STYLE_OPTIONS = [
  "Frequent texter",
  "Call me maybe",
  "Video chat enthusiast",
  "Better in person",
  "Mix of everything",
] as const;

const requiresChildrenCount = (value: string): boolean =>
  value.trim().toLowerCase().startsWith("yes");

const extractChildrenCount = (value: string | null | undefined): string => {
  if (!value) return "";
  const match = String(value).match(/(\d+)/);
  return match ? match[1] : "";
};

const normalizeGender = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower === "male") return "Male";
  if (lower === "female") return "Female";
  return trimmed;
};

const normalizeHeight = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();

  // Check if it matches any of our options
  const match = HEIGHT_OPTIONS.find((option) => option.toLowerCase() === lower);
  if (match) return match;

  // Handle common variations
  if (lower.includes("prefer not")) return "Prefer not to say";
  if (lower.includes("under 3")) return "Under 3'";
  if (lower.includes("over 7")) return "Over 7'6\"";

  return trimmed;
};

const normalizeBodyType = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const match = BODY_TYPE_OPTIONS.find(
    (option) => option.toLowerCase() === lower
  );
  if (match) return match;
  if (lower.includes("prefer not")) return "Prefer not to say";
  return trimmed;
};

const normalizeSmoking = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (
    lower === "no" ||
    lower === "non smoker" ||
    lower === "don't smoke" ||
    lower === "dont smoke"
  )
    return "No";
  if (lower === "yes" || lower === "do smoke" || lower === "smoker")
    return "Yes";
  if (
    lower === "yes, occasionally" ||
    lower === "occasionally smoke" ||
    lower === "occasional smoker" ||
    lower === "occasionally"
  )
    return "Yes, occasionally";
  if (lower.includes("prefer not")) return "Prefer not to say";
  return trimmed;
};

const normalizeDrinking = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (
    lower === "no" ||
    lower === "non drinker" ||
    lower === "don't drink" ||
    lower === "dont drink"
  )
    return "No";
  if (lower === "yes" || lower === "do drink" || lower === "drinker")
    return "Yes";
  if (
    lower === "yes, socially" ||
    lower === "socially" ||
    lower === "social drinker" ||
    lower === "occasionally drink" ||
    lower === "occasionally"
  )
    return "Yes, socially";
  if (lower.includes("prefer not")) return "Prefer not to say";
  return trimmed;
};

const normalizeChildren = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower === "no" || lower === "none") return "No";
  if (
    lower.includes("live with me") ||
    lower.includes("living with me") ||
    lower.includes("live together") ||
    lower.includes("same home")
  )
    return "Yes, they live with me";
  if (
    lower.includes("don't live") ||
    lower.includes("dont live") ||
    lower.includes("separate") ||
    lower.includes("don't live with me")
  )
    return "Yes, they don't live with me";
  if (lower.includes("prefer not")) return "Prefer not to say";
  return trimmed;
};

const normalizeRelocation = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("open to relocating") ||
    (lower.includes("willing") && !lower.includes("right person"))
  )
    return "Open to relocating";
  if (lower.includes("right person") || lower.includes("for the right"))
    return "Willing to relocate for the right person";
  if (
    lower.includes("not open") ||
    lower.startsWith("not") ||
    lower.includes("not willing")
  )
    return "Not open to relocating";
  if (
    lower.includes("not sure") ||
    lower.includes("unsure") ||
    lower.includes("not sure yet")
  )
    return "Not sure yet";
  return trimmed;
};

const normalizeReligion = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const match = RELIGION_OPTIONS.find(
    (option) => option.toLowerCase() === lower
  );
  if (match) return match;
  if (lower.includes("spiritual")) return "Spiritual but not religious";
  if (lower.includes("atheist")) return "Atheist";
  if (lower.includes("agnostic")) return "Agnostic";
  return trimmed;
};

const selectionToGeoLocation = (
  selection: LocationSelection
): GeoLocation | null => {
  if (!selection.countryCode) return null;
  const formatted = [
    selection.cityName,
    selection.stateName,
    selection.countryName,
  ]
    .filter((part) => part && part.trim().length > 0)
    .join(", ");
  return {
    city: selection.cityName || undefined,
    state: selection.stateName || undefined,
    stateCode: selection.stateCode || undefined,
    country: selection.countryName || selection.countryCode || undefined,
    countryCode: selection.countryCode || undefined,
    formatted: formatted || undefined,
  };
};

const EditLivesInForm: React.FC<EditLivesInFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selection, setSelection] = useState<LocationSelection>(
    initialValue ?? createEmptyLocationSelection()
  );

  useEffect(() => {
    setSelection(initialValue ?? createEmptyLocationSelection());
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!selection.countryCode) return;
    onSave(selection);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <LocationPicker value={selection} onChange={setSelection} />
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={!selection.countryCode || !selection.cityName}
        />
      </div>
    </form>
  );
};

const EditGenderForm: React.FC<EditGenderFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selectedGender, setSelectedGender] = useState<string>(
    normalizeGender(initialValue)
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setSelectedGender(normalizeGender(initialValue));
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!selectedGender.trim()) return;
    onSave(selectedGender);
  };

  const handleSelect = (value: string) => {
    setSelectedGender(value);
    setIsModalOpen(false);
  };

  const hasSelection = selectedGender.trim().length > 0;

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <Field label="Gender" htmlFor="gender-select">
            <button
              type="button"
              id="gender-select"
              onClick={() => setIsModalOpen(true)}
              className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
              aria-haspopup="dialog"
              aria-expanded={isModalOpen}
            >
              <span
                className={`${
                  hasSelection ? "text-gray-900" : "italic text-gray-400"
                } flex-1 min-w-0 text-left`}
              >
                {hasSelection ? selectedGender : "Select gender"}
              </span>
              <CaretDown
                size={16}
                className="ml-3 flex-none text-gray-500"
                aria-hidden
              />
            </button>
          </Field>
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={onCancel}
            primaryText="Save"
            primaryDisabled={!hasSelection}
          />
        </div>
      </form>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Select gender"
        size="sm"
        closeOnOverlayClick
      >
        <fieldset className="space-y-1" role="radiogroup">
          <legend className="sr-only">Gender options</legend>
          {GENDER_OPTIONS.map((option, index) => {
            const isActive =
              selectedGender.toLowerCase() === option.toLowerCase();
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
                  onChange={() => handleSelect(option)}
                  className="h-4 w-4 accent-red-500"
                  data-autofocus={index === 0 ? true : undefined}
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
    </>
  );
};

const EditHeightForm: React.FC<EditHeightFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selectedHeight, setSelectedHeight] = useState<string>(
    normalizeHeight(initialValue)
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setSelectedHeight(normalizeHeight(initialValue));
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!selectedHeight.trim()) return;
    onSave(selectedHeight);
  };

  const handleSelect = (value: string) => {
    setSelectedHeight(value);
    setIsModalOpen(false);
  };

  const hasSelection = selectedHeight.trim().length > 0;

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <Field label="Height" htmlFor="height-select">
            <button
              type="button"
              id="height-select"
              onClick={() => setIsModalOpen(true)}
              className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
              aria-haspopup="dialog"
              aria-expanded={isModalOpen}
            >
              <span
                className={`${
                  hasSelection ? "text-gray-900" : "italic text-gray-400"
                } flex-1 min-w-0 text-left`}
              >
                {hasSelection ? selectedHeight : "Select height"}
              </span>
              <CaretDown
                size={16}
                className="ml-3 flex-none text-gray-500"
                aria-hidden
              />
            </button>
          </Field>
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={onCancel}
            primaryText="Save"
            primaryDisabled={!hasSelection}
          />
        </div>
      </form>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Select height"
        size="sm"
        closeOnOverlayClick
      >
        <fieldset
          className="space-y-1 max-h-96 overflow-y-auto"
          role="radiogroup"
        >
          <legend className="sr-only">Height options</legend>
          {HEIGHT_OPTIONS.map((option, index) => {
            const isActive =
              selectedHeight.toLowerCase() === option.toLowerCase();
            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="height-option"
                  value={option}
                  checked={isActive}
                  onChange={() => handleSelect(option)}
                  className="h-4 w-4 accent-red-500"
                  data-autofocus={index === 0 ? true : undefined}
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
    </>
  );
};

const EditBodyTypeForm: React.FC<EditBodyTypeFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selectedBodyType, setSelectedBodyType] = useState<string>(
    normalizeBodyType(initialValue)
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setSelectedBodyType(normalizeBodyType(initialValue));
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!selectedBodyType.trim()) return;
    onSave(selectedBodyType);
  };

  const handleSelect = (value: string) => {
    setSelectedBodyType(value);
    setIsModalOpen(false);
  };

  const hasSelection = selectedBodyType.trim().length > 0;

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <Field label="Body type" htmlFor="body-type-select">
            <button
              type="button"
              id="body-type-select"
              onClick={() => setIsModalOpen(true)}
              className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
              aria-haspopup="dialog"
              aria-expanded={isModalOpen}
            >
              <span
                className={`${
                  hasSelection ? "text-gray-900" : "italic text-gray-400"
                } flex-1 min-w-0 text-left`}
              >
                {hasSelection ? selectedBodyType : "Select body type"}
              </span>
              <CaretDown
                size={16}
                className="ml-3 flex-none text-gray-500"
                aria-hidden
              />
            </button>
          </Field>
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={onCancel}
            primaryText="Save"
            primaryDisabled={!hasSelection}
          />
        </div>
      </form>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Select body type"
        size="sm"
        closeOnOverlayClick
      >
        <fieldset className="space-y-1" role="radiogroup">
          <legend className="sr-only">Body type options</legend>
          {BODY_TYPE_OPTIONS.map((option, index) => {
            const isActive =
              selectedBodyType.toLowerCase() === option.toLowerCase();
            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="body-type-option"
                  value={option}
                  checked={isActive}
                  onChange={() => handleSelect(option)}
                  className="h-4 w-4 accent-red-500"
                  data-autofocus={index === 0 ? true : undefined}
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
    </>
  );
};

const EditAgeForm: React.FC<EditAgeFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [age, setAge] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setAge(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = age.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="Age" htmlFor="age-input">
          <input
            id="age-input"
            type="number"
            inputMode="numeric"
            min={18}
            max={120}
            step={1}
            className={fieldControlClasses}
            placeholder="Enter age"
            value={age}
            onChange={(event) => setAge(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={age.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditProfileHeadingForm: React.FC<EditProfileHeadingFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [heading, setHeading] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setHeading(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = heading.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="Introduce yourself" htmlFor="profile-heading-input">
          <textarea
            id="profile-heading-input"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="Write a short introduction"
            value={heading}
            onChange={(event) => setHeading(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={heading.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditPartnerLookingForForm: React.FC<EditPartnerLookingForFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [lookingFor, setLookingFor] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setLookingFor(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = lookingFor.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field
          label="What are you looking for in a partner?"
          htmlFor="partner-looking-input"
        >
          <textarea
            id="partner-looking-input"
            rows={4}
            className={`${fieldControlClasses} resize-none`}
            placeholder="Share what matters most to you"
            value={lookingFor}
            onChange={(event) => setLookingFor(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={lookingFor.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditFavoriteMovieForm: React.FC<EditFavoriteMovieFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [favoriteMovie, setFavoriteMovie] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setFavoriteMovie(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = favoriteMovie.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="What is your favorite movie?" htmlFor="favorite-movie">
          <textarea
            id="favorite-movie"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="Add a movie that really speaks to you"
            value={favoriteMovie}
            onChange={(event) => setFavoriteMovie(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={favoriteMovie.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditMusicPreferenceForm: React.FC<EditMusicPreferenceFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [music, setMusic] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setMusic(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = music.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field
          label="What sort of music do you like?"
          htmlFor="music-preference"
        >
          <textarea
            id="music-preference"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="Describe the sounds you love"
            value={music}
            onChange={(event) => setMusic(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={music.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditFoodPreferenceForm: React.FC<EditFoodPreferenceFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [food, setFood] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setFood(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = food.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="What sort of food do you like?" htmlFor="food-preference">
          <textarea
            id="food-preference"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="Let others know your go-to flavors"
            value={food}
            onChange={(event) => setFood(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={food.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditPerfectMatchForm: React.FC<EditPerfectMatchFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [perfectMatch, setPerfectMatch] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setPerfectMatch(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = perfectMatch.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field
          label="What sort of person would be your perfect match?"
          htmlFor="perfect-match"
        >
          <textarea
            id="perfect-match"
            rows={4}
            className={`${fieldControlClasses} resize-none`}
            placeholder="Share what your ideal partner is like"
            value={perfectMatch}
            onChange={(event) => setPerfectMatch(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={perfectMatch.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditHobbyForm: React.FC<EditHobbyFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [hobby, setHobby] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setHobby(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = hobby.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="My go-to hobby" htmlFor="hobby">
          <textarea
            id="hobby"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="What do you love doing in your free time?"
            value={hobby}
            onChange={(event) => setHobby(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={hobby.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditWeekendActivityForm: React.FC<EditWeekendActivityFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [activity, setActivity] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setActivity(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = activity.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="Perfect weekend activity" htmlFor="weekend-activity">
          <textarea
            id="weekend-activity"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="How do you like to spend your weekends?"
            value={activity}
            onChange={(event) => setActivity(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={activity.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditTravelDestinationForm: React.FC<EditTravelDestinationFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [destination, setDestination] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setDestination(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = destination.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="Dream travel destination" htmlFor="travel-destination">
          <textarea
            id="travel-destination"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="Where's your dream travel spot?"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={destination.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditFitnessActivityForm: React.FC<EditFitnessActivityFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [fitness, setFitness] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setFitness(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = fitness.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="How I stay active" htmlFor="fitness-activity">
          <textarea
            id="fitness-activity"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="What's your favorite way to stay fit?"
            value={fitness}
            onChange={(event) => setFitness(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={fitness.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditEducationForm: React.FC<EditEducationFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selectedOption, setSelectedOption] = useState<string>(
    initialValue?.trim() ?? ""
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setSelectedOption(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!selectedOption.trim()) return;
    onSave(selectedOption);
  };

  const handleSelect = (value: string) => {
    setSelectedOption(value);
    setIsModalOpen(false);
  };

  const hasSelection = selectedOption.trim().length > 0;

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <Field label="Education" htmlFor="education-select">
            <button
              type="button"
              id="education-select"
              onClick={() => setIsModalOpen(true)}
              className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
              aria-haspopup="dialog"
              aria-expanded={isModalOpen}
            >
              <span
                className={`${
                  hasSelection ? "text-gray-900" : "italic text-gray-400"
                } flex-1 min-w-0 text-left`}
              >
                {hasSelection ? selectedOption : "Select education"}
              </span>
              <CaretDown
                size={16}
                className="ml-3 flex-none text-gray-500"
                aria-hidden
              />
            </button>
          </Field>
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={onCancel}
            primaryText="Save"
            primaryDisabled={!hasSelection}
          />
        </div>
      </form>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Select education"
        size="sm"
        closeOnOverlayClick
      >
        <fieldset className="space-y-1" role="radiogroup">
          <legend className="sr-only">Education options</legend>
          {EDUCATION_OPTIONS.map((option, index) => {
            const isActive =
              selectedOption.toLowerCase() === option.toLowerCase();
            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="education-option"
                  value={option}
                  checked={isActive}
                  onChange={() => handleSelect(option)}
                  className="h-4 w-4 accent-red-500"
                  data-autofocus={index === 0 ? true : undefined}
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
    </>
  );
};

const EditFirstNameForm: React.FC<EditFirstNameFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [firstName, setFirstName] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setFirstName(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = firstName.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="First name" htmlFor="first-name">
          <textarea
            id="first-name"
            rows={2}
            className={`${fieldControlClasses} resize-none`}
            placeholder="What should we call you?"
            maxLength={80}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={firstName.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditJobTitleForm: React.FC<EditJobTitleFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [jobTitle, setJobTitle] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setJobTitle(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = jobTitle.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="Job title" htmlFor="job-title">
          <textarea
            id="job-title"
            rows={2}
            className={`${fieldControlClasses} resize-none`}
            placeholder="What do you do for work?"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={jobTitle.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditCompanyForm: React.FC<EditCompanyFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [company, setCompany] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setCompany(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = company.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="Company" htmlFor="company">
          <textarea
            id="company"
            rows={2}
            className={`${fieldControlClasses} resize-none`}
            placeholder="Where do you work?"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={company.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditLifePhilosophyForm: React.FC<EditLifePhilosophyFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [philosophy, setPhilosophy] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setPhilosophy(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = philosophy.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="My philosophy" htmlFor="life-philosophy">
          <textarea
            id="life-philosophy"
            rows={4}
            className={`${fieldControlClasses} resize-none`}
            placeholder="What's your outlook on life?"
            value={philosophy}
            onChange={(event) => setPhilosophy(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={philosophy.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditCommunicationStyleForm: React.FC<EditCommunicationStyleFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selectedOption, setSelectedOption] = useState<string>(
    initialValue?.trim() ?? ""
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setSelectedOption(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!selectedOption.trim()) return;
    onSave(selectedOption);
  };

  const handleSelect = (value: string) => {
    setSelectedOption(value);
    setIsModalOpen(false);
  };

  const hasSelection = selectedOption.trim().length > 0;

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <Field
            label="Communication style"
            htmlFor="communication-style-select"
          >
            <button
              type="button"
              id="communication-style-select"
              onClick={() => setIsModalOpen(true)}
              className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
              aria-haspopup="dialog"
              aria-expanded={isModalOpen}
            >
              <span
                className={`${
                  hasSelection ? "text-gray-900" : "italic text-gray-400"
                } flex-1 min-w-0 text-left`}
              >
                {hasSelection ? selectedOption : "Select communication style"}
              </span>
              <CaretDown
                size={16}
                className="ml-3 flex-none text-gray-500"
                aria-hidden
              />
            </button>
          </Field>
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={onCancel}
            primaryText="Save"
            primaryDisabled={!hasSelection}
          />
        </div>
      </form>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Select communication style"
        size="sm"
        closeOnOverlayClick
      >
        <fieldset className="space-y-1" role="radiogroup">
          <legend className="sr-only">Communication style options</legend>
          {COMMUNICATION_STYLE_OPTIONS.map((option, index) => {
            const isActive =
              selectedOption.toLowerCase() === option.toLowerCase();
            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="communication-style-option"
                  value={option}
                  checked={isActive}
                  onChange={() => handleSelect(option)}
                  className="h-4 w-4 accent-red-500"
                  data-autofocus={index === 0 ? true : undefined}
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
    </>
  );
};

const EditDatingProConForm: React.FC<EditDatingProConFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [proCon, setProCon] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setProCon(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = proCon.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="A pro and con of dating me" htmlFor="dating-pro-con">
          <textarea
            id="dating-pro-con"
            rows={4}
            className={`${fieldControlClasses} resize-none`}
            placeholder="Share a pro and a con about dating you"
            value={proCon}
            onChange={(event) => setProCon(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={proCon.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditLoveLanguageForm: React.FC<EditLoveLanguageFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [loveLanguage, setLoveLanguage] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setLoveLanguage(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = loveLanguage.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="My love language" htmlFor="love-language">
          <textarea
            id="love-language"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="How do you express and receive love?"
            value={loveLanguage}
            onChange={(event) => setLoveLanguage(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={loveLanguage.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditFirstDateForm: React.FC<EditFirstDateFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [firstDate, setFirstDate] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setFirstDate(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = firstDate.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="The perfect first date" htmlFor="first-date">
          <textarea
            id="first-date"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="Describe your ideal first date"
            value={firstDate}
            onChange={(event) => setFirstDate(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={firstDate.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditGreenFlagForm: React.FC<EditGreenFlagFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [greenFlag, setGreenFlag] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setGreenFlag(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = greenFlag.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="A green flag I look for" htmlFor="green-flag">
          <textarea
            id="green-flag"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="What's a quality you appreciate in others?"
            value={greenFlag}
            onChange={(event) => setGreenFlag(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={greenFlag.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditRedFlagForm: React.FC<EditRedFlagFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [redFlag, setRedFlag] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setRedFlag(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = redFlag.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="A dealbreaker for me" htmlFor="red-flag">
          <textarea
            id="red-flag"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="What's something you can't compromise on?"
            value={redFlag}
            onChange={(event) => setRedFlag(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={redFlag.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditSeekingForForm: React.FC<EditSeekingForFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [seekingFor, setSeekingFor] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setSeekingFor(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = seekingFor.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="Seeking for" htmlFor="seeking-for">
          <textarea
            id="seeking-for"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="What kind of relationship or partner are you seeking?"
            value={seekingFor}
            onChange={(event) => setSeekingFor(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={seekingFor.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditSelfCareForm: React.FC<EditSelfCareFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selfCare, setSelfCare] = useState<string>(initialValue?.trim() ?? "");

  useEffect(() => {
    setSelfCare(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = selfCare.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="To me self-care is" htmlFor="self-care">
          <textarea
            id="self-care"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="How do you practice self-care?"
            value={selfCare}
            onChange={(event) => setSelfCare(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={selfCare.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditSimplePleasuresForm: React.FC<EditSimplePleasuresFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [simplePleasures, setSimplePleasures] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setSimplePleasures(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = simplePleasures.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field label="My simple pleasures are" htmlFor="simple-pleasures">
          <textarea
            id="simple-pleasures"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="What are the little things that bring you joy?"
            value={simplePleasures}
            onChange={(event) => setSimplePleasures(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={simplePleasures.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditGreatRelationshipForm: React.FC<EditGreatRelationshipFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [greatRelationship, setGreatRelationship] = useState<string>(
    initialValue?.trim() ?? ""
  );

  useEffect(() => {
    setGreatRelationship(initialValue?.trim() ?? "");
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const normalized = greatRelationship.trim();
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <form className="flex h-full flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto pb-8">
        <Field
          label="What makes a relationship great"
          htmlFor="great-relationship"
        >
          <textarea
            id="great-relationship"
            rows={3}
            className={`${fieldControlClasses} resize-none`}
            placeholder="What are the key ingredients for a great relationship?"
            value={greatRelationship}
            onChange={(event) => setGreatRelationship(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-auto">
        <ActionButtons
          secondaryText="Cancel"
          onSecondary={onCancel}
          primaryText="Save"
          primaryDisabled={greatRelationship.trim().length === 0}
        />
      </div>
    </form>
  );
};

const EditSmokingForm: React.FC<EditSmokingFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selectedOption, setSelectedOption] = useState<string>(
    normalizeSmoking(initialValue)
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setSelectedOption(normalizeSmoking(initialValue));
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!selectedOption.trim()) return;
    onSave(selectedOption);
  };

  const handleSelect = (value: string) => {
    setSelectedOption(value);
    setIsModalOpen(false);
  };

  const hasSelection = selectedOption.trim().length > 0;

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <Field label="Smoking" htmlFor="smoking-select">
            <button
              type="button"
              id="smoking-select"
              onClick={() => setIsModalOpen(true)}
              className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
              aria-haspopup="dialog"
              aria-expanded={isModalOpen}
            >
              <span
                className={`${
                  hasSelection ? "text-gray-900" : "italic text-gray-400"
                } flex-1 min-w-0 text-left`}
              >
                {hasSelection ? selectedOption : "Select an option"}
              </span>
              <CaretDown
                size={16}
                className="ml-3 flex-none text-gray-500"
                aria-hidden
              />
            </button>
          </Field>
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={onCancel}
            primaryText="Save"
            primaryDisabled={!hasSelection}
          />
        </div>
      </form>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Smoking"
        size="sm"
        closeOnOverlayClick
      >
        <fieldset className="space-y-1" role="radiogroup">
          <legend className="sr-only">Smoking options</legend>
          {SMOKING_OPTIONS.map((option, index) => {
            const isActive =
              selectedOption.toLowerCase() === option.toLowerCase();
            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="smoking-option"
                  value={option}
                  checked={isActive}
                  onChange={() => handleSelect(option)}
                  className="h-4 w-4 accent-red-500"
                  data-autofocus={index === 0 ? true : undefined}
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
    </>
  );
};

const EditDrinkingForm: React.FC<EditDrinkingFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selectedOption, setSelectedOption] = useState<string>(
    normalizeDrinking(initialValue)
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setSelectedOption(normalizeDrinking(initialValue));
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!selectedOption.trim()) return;
    onSave(selectedOption);
  };

  const handleSelect = (value: string) => {
    setSelectedOption(value);
    setIsModalOpen(false);
  };

  const hasSelection = selectedOption.trim().length > 0;

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <Field label="Drinking" htmlFor="drinking-select">
            <button
              type="button"
              id="drinking-select"
              onClick={() => setIsModalOpen(true)}
              className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
              aria-haspopup="dialog"
              aria-expanded={isModalOpen}
            >
              <span
                className={`${
                  hasSelection ? "text-gray-900" : "italic text-gray-400"
                } flex-1 min-w-0 text-left`}
              >
                {hasSelection ? selectedOption : "Select an option"}
              </span>
              <CaretDown
                size={16}
                className="ml-3 flex-none text-gray-500"
                aria-hidden
              />
            </button>
          </Field>
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={onCancel}
            primaryText="Save"
            primaryDisabled={!hasSelection}
          />
        </div>
      </form>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Drinking"
        size="sm"
        closeOnOverlayClick
      >
        <fieldset className="space-y-1" role="radiogroup">
          <legend className="sr-only">Drinking options</legend>
          {DRINKING_OPTIONS.map((option, index) => {
            const isActive =
              selectedOption.toLowerCase() === option.toLowerCase();
            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="drinking-option"
                  value={option}
                  checked={isActive}
                  onChange={() => handleSelect(option)}
                  className="h-4 w-4 accent-red-500"
                  data-autofocus={index === 0 ? true : undefined}
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
    </>
  );
};

const EditReligionForm: React.FC<EditReligionFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selectedOption, setSelectedOption] = useState<string>(
    normalizeReligion(initialValue)
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setSelectedOption(normalizeReligion(initialValue));
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!selectedOption.trim()) return;
    onSave(selectedOption);
  };

  const handleSelect = (value: string) => {
    setSelectedOption(value);
    setIsModalOpen(false);
  };

  const hasSelection = selectedOption.trim().length > 0;

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <Field label="Religion" htmlFor="religion-select">
            <button
              type="button"
              id="religion-select"
              onClick={() => setIsModalOpen(true)}
              className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
              aria-haspopup="dialog"
              aria-expanded={isModalOpen}
            >
              <span
                className={`${
                  hasSelection ? "text-gray-900" : "italic text-gray-400"
                } flex-1 min-w-0 text-left`}
              >
                {hasSelection ? selectedOption : "Select religion"}
              </span>
              <CaretDown
                size={16}
                className="ml-3 flex-none text-gray-500"
                aria-hidden
              />
            </button>
          </Field>
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={onCancel}
            primaryText="Save"
            primaryDisabled={!hasSelection}
          />
        </div>
      </form>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Select religion"
        size="sm"
        closeOnOverlayClick
      >
        <fieldset className="space-y-1" role="radiogroup">
          <legend className="sr-only">Religion options</legend>
          {RELIGION_OPTIONS.map((option, index) => {
            const isActive =
              selectedOption.toLowerCase() === option.toLowerCase();
            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="religion-option"
                  value={option}
                  checked={isActive}
                  onChange={() => handleSelect(option)}
                  className="h-4 w-4 accent-red-500"
                  data-autofocus={index === 0 ? true : undefined}
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
    </>
  );
};

const EditChildrenForm: React.FC<EditChildrenFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selectedOption, setSelectedOption] = useState<string>(
    normalizeChildren(initialValue?.choice)
  );
  const [childCount, setChildCount] = useState<string>(
    initialValue?.count?.trim() ?? ""
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const nextChoice = normalizeChildren(initialValue?.choice);
    setSelectedOption(nextChoice);
    setChildCount(
      requiresChildrenCount(nextChoice) ? initialValue?.count?.trim() ?? "" : ""
    );
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const choice = selectedOption.trim();
    if (!choice) return;
    const needsCount = requiresChildrenCount(choice);
    const normalizedCount = childCount.trim();
    if (needsCount && (!normalizedCount || Number(normalizedCount) <= 0)) {
      return;
    }
    onSave({
      choice,
      count: needsCount ? normalizedCount : "",
    });
  };

  const handleSelect = (value: string) => {
    const normalized = normalizeChildren(value);
    setSelectedOption(normalized);
    if (!requiresChildrenCount(normalized)) {
      setChildCount("");
    }
    setIsModalOpen(false);
  };

  const hasSelection = selectedOption.trim().length > 0;
  const needsCount = requiresChildrenCount(selectedOption);
  const countValue = childCount.trim();
  const isCountValid = !needsCount || (countValue && Number(countValue) > 0);
  const canSave = hasSelection && isCountValid;

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <Field label="Kids" htmlFor="children-select">
            <button
              type="button"
              id="children-select"
              onClick={() => setIsModalOpen(true)}
              className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
              aria-haspopup="dialog"
              aria-expanded={isModalOpen}
            >
              <span
                className={`${
                  hasSelection ? "text-gray-900" : "italic text-gray-400"
                } flex-1 min-w-0 text-left`}
              >
                {hasSelection ? selectedOption : "Select an option"}
              </span>
              <CaretDown
                size={16}
                className="ml-3 flex-none text-gray-500"
                aria-hidden
              />
            </button>
          </Field>
          {needsCount ? (
            <Field label="Number of children" htmlFor="children-count">
              <input
                id="children-count"
                type="number"
                min={1}
                step={1}
                className={fieldControlClasses}
                placeholder="Enter number of children"
                value={childCount}
                onChange={(event) => setChildCount(event.target.value)}
                inputMode="numeric"
              />
            </Field>
          ) : null}
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={onCancel}
            primaryText="Save"
            primaryDisabled={!canSave}
          />
        </div>
      </form>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Kids"
        size="sm"
        closeOnOverlayClick
      >
        <fieldset className="space-y-1" role="radiogroup">
          <legend className="sr-only">Children options</legend>
          {CHILDREN_OPTIONS.map((option, index) => {
            const isActive =
              selectedOption.toLowerCase() === option.toLowerCase();
            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="children-option"
                  value={option}
                  checked={isActive}
                  onChange={() => handleSelect(option)}
                  className="h-4 w-4 accent-red-500"
                  data-autofocus={index === 0 ? true : undefined}
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
    </>
  );
};

const EditRelocationForm: React.FC<EditRelocationFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selectedOption, setSelectedOption] = useState<string>(
    normalizeRelocation(initialValue)
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setSelectedOption(normalizeRelocation(initialValue));
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!selectedOption.trim()) return;
    onSave(selectedOption);
  };

  const handleSelect = (value: string) => {
    setSelectedOption(value);
    setIsModalOpen(false);
  };

  const hasSelection = selectedOption.trim().length > 0;

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <Field label="Open to relocating" htmlFor="relocation-select">
            <button
              type="button"
              id="relocation-select"
              onClick={() => setIsModalOpen(true)}
              className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
              aria-haspopup="dialog"
              aria-expanded={isModalOpen}
            >
              <span
                className={`${
                  hasSelection ? "text-gray-900" : "italic text-gray-400"
                } flex-1 min-w-0 text-left`}
              >
                {hasSelection ? selectedOption : "Select an option"}
              </span>
              <CaretDown
                size={16}
                className="ml-3 flex-none text-gray-500"
                aria-hidden
              />
            </button>
          </Field>
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={onCancel}
            primaryText="Save"
            primaryDisabled={!hasSelection}
          />
        </div>
      </form>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Open to relocating"
        size="sm"
        closeOnOverlayClick
      >
        <fieldset className="space-y-1" role="radiogroup">
          <legend className="sr-only">Relocation options</legend>
          {RELOCATION_OPTIONS.map((option, index) => {
            const isActive =
              selectedOption.toLowerCase() === option.toLowerCase();
            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="relocation-option"
                  value={option}
                  checked={isActive}
                  onChange={() => handleSelect(option)}
                  className="h-4 w-4 accent-red-500"
                  data-autofocus={index === 0 ? true : undefined}
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
    </>
  );
};

const toLocationFromCountry = (
  value: string | null | undefined,
  countries: ICountry[]
): LocationSelection => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return createEmptyLocationSelection();
  }
  const lower = trimmed.toLowerCase();
  const match = countries.find((country) => {
    const iso = String(country.isoCode || "").toLowerCase();
    const name = String(country.name || "").toLowerCase();
    return iso === lower || name === lower;
  });
  if (!match) {
    return {
      ...createEmptyLocationSelection(),
      countryName: trimmed,
    };
  }
  return {
    countryCode: match.isoCode,
    countryName: match.name,
    stateCode: "",
    stateName: "",
    cityName: "",
  };
};

const EditNationalityForm: React.FC<EditNationalityFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const countries = useMemo<ICountry[]>(() => Country.getAllCountries(), []);
  const [selection, setSelection] = useState<LocationSelection>(() =>
    toLocationFromCountry(initialValue, countries)
  );

  useEffect(() => {
    const resolved = toLocationFromCountry(initialValue, countries);
    setSelection(resolved);
  }, [initialValue, countries]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!selection.countryCode) return;
    onSave(selection.countryName);
  };

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <LocationPicker
            value={selection}
            onChange={(value) =>
              setSelection({
                countryCode: value.countryCode,
                countryName: value.countryName,
                stateCode: "",
                stateName: "",
                cityName: "",
              })
            }
            hideState
            hideCity
            countryLabel="Nationality"
            countryPlaceholder="Select nationality"
          />
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={onCancel}
            primaryText="Save"
            primaryDisabled={!selection.countryCode}
          />
        </div>
      </form>
    </>
  );
};

const EditRelationshipForm: React.FC<EditRelationshipFormProps> = ({
  initialValue,
  onCancel,
  onSave,
}) => {
  const [selectedOptions, setSelectedOptions] = useState<string[]>(() =>
    toCanonicalRelationshipList(initialValue)
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setSelectedOptions(toCanonicalRelationshipList(initialValue));
  }, [initialValue]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (selectedOptions.length === 0) return;
    setIsModalOpen(false);
    onSave(selectedOptions);
  };

  const handleCancel = () => {
    setIsModalOpen(false);
    onCancel();
  };

  const toggleOption = (option: string) => {
    const canonical = normalizeRelationship(option);
    if (!canonical) return;
    setSelectedOptions((prev) => {
      const exists = prev.some(
        (item) => item.toLowerCase() === canonical.toLowerCase()
      );
      if (exists) {
        const next = prev.filter(
          (item) => item.toLowerCase() !== canonical.toLowerCase()
        );
        return sortRelationshipOptions(next);
      }
      return sortRelationshipOptions([...prev, canonical]);
    });
  };

  const hasSelection = selectedOptions.length > 0;
  const summaryLabel =
    selectedOptions.length > 0
      ? selectedOptions.join(", ")
      : "Select one or more options";

  return (
    <>
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-6 overflow-y-auto pb-8">
          <Field label="Looking for" htmlFor="relationship-select">
            <button
              type="button"
              id="relationship-select"
              onClick={() => setIsModalOpen(true)}
              className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
              aria-haspopup="dialog"
              aria-expanded={isModalOpen}
            >
              <span
                className={`${
                  hasSelection ? "text-gray-900" : "italic text-gray-400"
                } flex-1 min-w-0 text-left`}
              >
                {summaryLabel}
              </span>
              <CaretDown
                size={16}
                className="ml-3 flex-none text-gray-500"
                aria-hidden
              />
            </button>
          </Field>
        </div>
        <div className="mt-auto">
          <ActionButtons
            secondaryText="Cancel"
            onSecondary={handleCancel}
            primaryText="Save"
            primaryDisabled={!hasSelection}
          />
        </div>
      </form>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Looking for"
        size="sm"
        closeOnOverlayClick
      >
        <div className="space-y-1" role="group" aria-label="Looking for">
          {RELATIONSHIP_OPTIONS.map((option) => {
            const isActive = selectedOptions.some(
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
                  onChange={() => toggleOption(option)}
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
    </>
  );
};

type SectionGroupProps = {
  title: string;
  items: { label: string; value?: string | null }[];
  showTopDivider?: boolean;
  onEdit: (groupTitle: string, fieldLabel: string) => void;
  sectionId?: string;
  isHighlighted?: boolean;
  highlightKey?: number;
};

const SectionGroup: React.FC<SectionGroupProps> = ({
  title,
  items,
  showTopDivider = false,
  onEdit,
  sectionId,
  isHighlighted = false,
  highlightKey,
}) => (
  <motion.section
    className={`relative mt-8 ${showTopDivider ? "" : "first:mt-0"} ${
      isHighlighted
        ? "rounded-2xl ring-2 ring-pink-300 ring-offset-2 ring-offset-white"
        : ""
    }`}
    id={sectionId ? `section-${sectionId}` : undefined}
    data-section-id={sectionId}
    data-highlight-key={highlightKey !== undefined ? highlightKey : undefined}
    tabIndex={sectionId ? -1 : undefined}
    layout
    initial={{ opacity: 0, y: 18 }}
    animate={{
      opacity: 1,
      y: 0,
      scale: isHighlighted ? 1.02 : 1,
    }}
    transition={{
      duration: 0.28,
      ease: "easeOut",
      ...(isHighlighted ? { type: "spring", stiffness: 220, damping: 18 } : {}),
    }}
  >
    <div className="relative z-10">
      {showTopDivider && <div className="mb-6 h-px bg-gray-200" />}
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <ul className="mt-4 divide-y divide-gray-200">
        {items.map(({ label, value }) => {
          const resolved =
            value === null || value === undefined ? "" : String(value);
          const hasValue = resolved.trim().length > 0;
          return (
            <li key={label} className="py-4">
              <div className="text-sm font-medium text-gray-500">{label}</div>
              <motion.button
                type="button"
                className="mt-2 flex w-full items-start justify-between gap-3 text-left"
                onClick={() => onEdit(title, label)}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <span
                  className={`${
                    hasValue
                      ? "text-base text-gray-900"
                      : "text-base italic text-gray-400"
                  } flex-1 min-w-0 text-left`}
                >
                  {hasValue ? resolved : "Add answer"}
                </span>
                <PencilSimple
                  size={22}
                  className="flex-none text-gray-500"
                  aria-hidden
                />
              </motion.button>
            </li>
          );
        })}
      </ul>
    </div>
  </motion.section>
);

const EditDatingProfileProfile: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const locationState = location.state as {
    focusSection?: string;
    focusTimestamp?: number;
  } | null;
  const focusSectionFromState =
    locationState?.focusSection?.toLowerCase() ?? null;
  const focusSectionFromQuery = useMemo(() => {
    if (!location.search) return null;
    const params = new URLSearchParams(location.search);
    const value = params.get("section");
    return value ? value.toLowerCase() : null;
  }, [location.search]);
  const focusSection = focusSectionFromState ?? focusSectionFromQuery ?? null;
  const { username, userId } = useAuthStore();
  const showToast = useUiStore((s) => s.showToast);
  const queryClient = useQueryClient();
  const broadcastDatingProfileUpdate = useSocketStore(
    (state) => state.broadcastDatingProfileUpdate
  );
  const { data: serverProfile } = useQuery({
    queryKey: ["datingProfile", userId ?? ""],
    queryFn: () => fetchDatingProfile({ userId }),
    enabled: !!userId,
  });
  const [activeEdit, setActiveEdit] = useState<{
    group: string;
    field: string;
  } | null>(null);
  const [firstNameDraft, setFirstNameDraft] = useState<string | null>(null);
  const [livesInDraft, setLivesInDraft] = useState<LocationSelection | null>(
    null
  );
  const [genderDraft, setGenderDraft] = useState<string | null>(null);
  const [heightDraft, setHeightDraft] = useState<string | null>(null);
  const [bodyTypeDraft, setBodyTypeDraft] = useState<string | null>(null);
  const [ageDraft, setAgeDraft] = useState<string | null>(null);
  const [smokingDraft, setSmokingDraft] = useState<string | null>(null);
  const [drinkingDraft, setDrinkingDraft] = useState<string | null>(null);
  const [childrenDraft, setChildrenDraft] = useState<ChildrenSelection | null>(
    null
  );
  const [relocationDraft, setRelocationDraft] = useState<string | null>(null);
  const [relationshipDraft, setRelationshipDraft] = useState<string[] | null>(
    null
  );
  const [religionDraft, setReligionDraft] = useState<string | null>(null);
  const [nationalityDraft, setNationalityDraft] = useState<string | null>(null);
  const [profileHeadingDraft, setProfileHeadingDraft] = useState<string | null>(
    null
  );
  const [lookingForDraft, setLookingForDraft] = useState<string | null>(null);
  const [favoriteMovieDraft, setFavoriteMovieDraft] = useState<string | null>(
    null
  );
  const [musicPreferenceDraft, setMusicPreferenceDraft] = useState<
    string | null
  >(null);
  const [foodPreferenceDraft, setFoodPreferenceDraft] = useState<string | null>(
    null
  );
  const [perfectMatchDraft, setPerfectMatchDraft] = useState<string | null>(
    null
  );
  const [hobbyDraft, setHobbyDraft] = useState<string | null>(null);
  const [weekendActivityDraft, setWeekendActivityDraft] = useState<
    string | null
  >(null);
  const [travelDestinationDraft, setTravelDestinationDraft] = useState<
    string | null
  >(null);
  const [fitnessActivityDraft, setFitnessActivityDraft] = useState<
    string | null
  >(null);
  const [educationDraft, setEducationDraft] = useState<string | null>(null);
  const [jobTitleDraft, setJobTitleDraft] = useState<string | null>(null);
  const [companyDraft, setCompanyDraft] = useState<string | null>(null);
  const [lifePhilosophyDraft, setLifePhilosophyDraft] = useState<string | null>(
    null
  );
  const [communicationStyleDraft, setCommunicationStyleDraft] = useState<
    string | null
  >(null);
  const [datingProConDraft, setDatingProConDraft] = useState<string | null>(
    null
  );
  const [loveLanguageDraft, setLoveLanguageDraft] = useState<string | null>(
    null
  );
  const [firstDateDraft, setFirstDateDraft] = useState<string | null>(null);
  const [greenFlagDraft, setGreenFlagDraft] = useState<string | null>(null);
  const [redFlagDraft, setRedFlagDraft] = useState<string | null>(null);
  const [seekingForDraft, setSeekingForDraft] = useState<string | null>(null);
  const [selfCareDraft, setSelfCareDraft] = useState<string | null>(null);
  const [simplePleasuresDraft, setSimplePleasuresDraft] = useState<
    string | null
  >(null);
  const [greatRelationshipDraft, setGreatRelationshipDraft] = useState<
    string | null
  >(null);
  const [successToastState, setSuccessToastState] = useState<{
    message: string;
    id: number;
  }>({
    message: "",
    id: 0,
  });
  const [isSuccessToastOpen, setIsSuccessToastOpen] = useState(false);
  const [highlightState, setHighlightState] = useState<{
    id: string;
    token: number;
  } | null>(focusSection ? { id: focusSection, token: Date.now() } : null);
  const highlightedSection = highlightState?.id ?? null;
  const highlightToken = highlightState?.token ?? 0;

  useEffect(() => {
    if (!focusSection) {
      return;
    }
    const scrollToSection = () => {
      const container = scrollContainerRef.current;
      if (!container) {
        return false;
      }
      const target = container.querySelector<HTMLElement>(
        `[data-section-id="${focusSection}"]`
      );
      if (!target) {
        return false;
      }
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const offset =
        container.scrollTop + (targetRect.top - containerRect.top) - 16;
      container.scrollTo({
        top: offset > 0 ? offset : 0,
        behavior: "smooth",
      });
      return true;
    };

    let timeoutId: number | undefined;
    if (!scrollToSection()) {
      timeoutId = window.setTimeout(() => {
        void scrollToSection();
      }, 150);
    }

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [focusSection, location.key]);

  useEffect(() => {
    if (!focusSection) {
      setHighlightState(null);
      return;
    }
    const token = Date.now();
    setHighlightState({ id: focusSection, token });
    const timeoutId = window.setTimeout(() => {
      setHighlightState((current) =>
        current && current.token === token ? null : current
      );
    }, 1600);
    return () => window.clearTimeout(timeoutId);
  }, [focusSection, location.key]);

  const updateProfileMutation = useMutation<
    DatingProfile,
    unknown,
    DatingProfileUpsert
  >({
    mutationFn: saveDatingProfile,
  });

  const openSuccessToast = useCallback((message: string) => {
    setSuccessToastState({ message, id: Date.now() });
    setIsSuccessToastOpen(true);
  }, []);

  const closeSuccessToast = useCallback(() => {
    setIsSuccessToastOpen(false);
  }, []);

  const handleStartEdit = useCallback((group: string, field: string) => {
    setActiveEdit({ group, field });
  }, []);

  const applyProfilePatch = useCallback(
    async (
      patch: DatingProfilePatch,
      options: {
        successMessage?: string;
        onSuccessCallback?: (profile: DatingProfile) => void;
      } = {}
    ) => {
      if (!userId) {
        showToast("Sign in to edit your profile.", 2500, "error");
        return;
      }
      if (updateProfileMutation.isPending) {
        showToast(
          "Please wait for the current update to finish.",
          2500,
          "error"
        );
        return;
      }
      try {
        const variables: DatingProfileUpsert = {
          userId,
          ...patch,
        };
        const profile = await updateProfileMutation.mutateAsync(variables);
        const profileUserId =
          typeof profile.userId === "string" ? profile.userId.trim() : "";
        const normalizedUsername = (username ?? "").trim();
        const usernameLower = normalizedUsername.toLowerCase();
        const usernameQueryKey = `username:${usernameLower}`;
        if (profileUserId) {
          queryClient.setQueryData(["datingProfile", profileUserId], profile);
        }
        if (normalizedUsername) {
          queryClient.setQueryData(
            ["datingProfile", normalizedUsername],
            profile
          );
          queryClient.setQueryData(
            ["datingProfile", usernameQueryKey],
            profile
          );
        }
        broadcastDatingProfileUpdate(profile);
        options.onSuccessCallback?.(profile);
        if (options.successMessage) {
          openSuccessToast(options.successMessage);
        }
        await queryClient
          .invalidateQueries({ queryKey: datingProfilesKey })
          .catch(() => {});
        broadcastMessage("tm:dating", { type: "dating:invalidate" });
      } catch (error) {
        const message =
          (error as any)?.response?.data?.detail ||
          (error instanceof Error ? error.message : undefined) ||
          "We couldn't save your profile. Try again.";
        showToast(message, 3000, "error");
      }
    },
    [
      userId,
      username,
      showToast,
      updateProfileMutation,
      queryClient,
      openSuccessToast,
      broadcastDatingProfileUpdate,
      broadcastMessage,
    ]
  );

  const countries = useMemo<ICountry[]>(() => Country.getAllCountries(), []);

  const livesInSelection = useMemo<LocationSelection | null>(() => {
    if (livesInDraft) return livesInDraft;
    const loc = serverProfile?.location;
    if (!loc) return null;
    const countryInput = String(loc.country || "").trim();
    const countryMatch = countries.find((country) => {
      const iso = country.isoCode?.toLowerCase();
      const name = country.name?.toLowerCase();
      const target = countryInput.toLowerCase();
      return iso === target || name === target;
    });
    const countryCode =
      countryMatch?.isoCode ||
      (countryInput.length === 2 ? countryInput.toUpperCase() : "");
    const countryName = countryMatch?.name || countryInput;

    let stateCode = "";
    let stateName = String(loc.state || "").trim();
    if (countryCode && stateName) {
      const states = State.getStatesOfCountry(countryCode) as IState[];
      const target = stateName.toLowerCase();
      const match = states.find((state) => {
        const iso = String(state.isoCode || "").toLowerCase();
        const name = state.name?.toLowerCase();
        return iso === target || name === target;
      });
      if (match) {
        stateCode = match.isoCode;
        stateName = match.name;
      }
    }

    return {
      countryCode,
      countryName,
      stateCode,
      stateName,
      cityName: String(loc.city || "").trim(),
    };
  }, [countries, livesInDraft, serverProfile]);

  const formattedLocation = useMemo(() => {
    if (!livesInSelection) return "";
    const parts = [
      livesInSelection.cityName,
      livesInSelection.stateName,
      livesInSelection.countryName,
    ].filter((part) => part && part.trim().length > 0);
    return parts.join(", ");
  }, [livesInSelection]);

  const firstNameValue = useMemo(() => {
    if (firstNameDraft !== null) {
      return firstNameDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      displayName?: string;
      firstName?: string;
      name?: string;
    };
    const value =
      possibleSources?.displayName ??
      possibleSources?.firstName ??
      possibleSources?.name ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [firstNameDraft, serverProfile]);

  const genderValue = useMemo(() => {
    if (genderDraft !== null) {
      return normalizeGender(genderDraft);
    }
    return normalizeGender(serverProfile?.gender);
  }, [genderDraft, serverProfile]);

  const heightValue = useMemo(() => {
    if (heightDraft !== null) {
      return normalizeHeight(heightDraft);
    }
    return normalizeHeight(
      (serverProfile as unknown as { height?: string })?.height
    );
  }, [heightDraft, serverProfile]);

  const bodyTypeValue = useMemo(() => {
    if (bodyTypeDraft !== null) {
      return normalizeBodyType(bodyTypeDraft);
    }
    const possibleSources = serverProfile as unknown as {
      bodyType?: string;
      body?: string;
      physique?: string;
    };
    return normalizeBodyType(
      possibleSources?.bodyType ??
        possibleSources?.body ??
        possibleSources?.physique ??
        ""
    );
  }, [bodyTypeDraft, serverProfile]);

  const ageValue = useMemo(() => {
    if (ageDraft !== null) {
      return ageDraft.trim();
    }
    if (typeof serverProfile?.age === "number") {
      return String(serverProfile.age);
    }
    if (typeof serverProfile?.age === "string") {
      return serverProfile.age;
    }
    return "";
  }, [ageDraft, serverProfile]);

  const smokingValue = useMemo(() => {
    if (smokingDraft !== null) {
      return normalizeSmoking(smokingDraft);
    }
    return normalizeSmoking(
      (serverProfile as unknown as { smoking?: string })?.smoking
    );
  }, [smokingDraft, serverProfile]);

  const drinkingValue = useMemo(() => {
    if (drinkingDraft !== null) {
      return normalizeDrinking(drinkingDraft);
    }
    return normalizeDrinking(
      (serverProfile as unknown as { drinking?: string })?.drinking
    );
  }, [drinkingDraft, serverProfile]);

  const religionValue = useMemo(() => {
    if (religionDraft !== null) {
      return normalizeReligion(religionDraft);
    }
    return normalizeReligion(
      (serverProfile as unknown as { religion?: string })?.religion
    );
  }, [religionDraft, serverProfile]);

  const childrenSelection = useMemo<ChildrenSelection>(() => {
    if (childrenDraft) {
      return {
        choice: normalizeChildren(childrenDraft.choice),
        count: childrenDraft.count?.trim() ?? "",
      };
    }
    const serverChildren =
      (serverProfile as unknown as {
        children?: string;
        childrenCount?: number;
      }) || {};
    const choice = normalizeChildren(serverChildren.children);
    const count =
      typeof serverChildren.childrenCount === "number" &&
      serverChildren.childrenCount > 0
        ? String(serverChildren.childrenCount)
        : extractChildrenCount(serverChildren.children);
    return { choice, count };
  }, [childrenDraft, serverProfile]);

  const favoriteMovieValue = useMemo(() => {
    if (favoriteMovieDraft !== null) {
      return favoriteMovieDraft.trim();
    }
    const value = (serverProfile as unknown as { favoriteMovie?: string })
      ?.favoriteMovie;
    return typeof value === "string" ? value.trim() : "";
  }, [favoriteMovieDraft, serverProfile]);

  const musicPreferenceValue = useMemo(() => {
    if (musicPreferenceDraft !== null) {
      return musicPreferenceDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      favoriteMusic?: string;
      musicPreference?: string;
      musicPreferences?: string;
    };
    const value =
      possibleSources?.favoriteMusic ??
      possibleSources?.musicPreference ??
      possibleSources?.musicPreferences ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [musicPreferenceDraft, serverProfile]);

  const foodPreferenceValue = useMemo(() => {
    if (foodPreferenceDraft !== null) {
      return foodPreferenceDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      favoriteFood?: string;
      foodPreference?: string;
      foodPreferences?: string;
    };
    const value =
      possibleSources?.favoriteFood ??
      possibleSources?.foodPreference ??
      possibleSources?.foodPreferences ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [foodPreferenceDraft, serverProfile]);

  const perfectMatchValue = useMemo(() => {
    if (perfectMatchDraft !== null) {
      return perfectMatchDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      perfectMatchDescription?: string;
      perfectMatch?: string;
      idealPartner?: string;
    };
    const value =
      possibleSources?.perfectMatchDescription ??
      possibleSources?.perfectMatch ??
      possibleSources?.idealPartner ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [perfectMatchDraft, serverProfile]);

  const hobbyValue = useMemo(() => {
    if (hobbyDraft !== null) {
      return hobbyDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      hobby?: string;
      hobbies?: string;
      favoriteHobby?: string;
    };
    const value =
      possibleSources?.hobby ??
      possibleSources?.hobbies ??
      possibleSources?.favoriteHobby ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [hobbyDraft, serverProfile]);

  const weekendActivityValue = useMemo(() => {
    if (weekendActivityDraft !== null) {
      return weekendActivityDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      weekendActivity?: string;
      weekendActivities?: string;
      typicalWeekend?: string;
    };
    const value =
      possibleSources?.weekendActivity ??
      possibleSources?.weekendActivities ??
      possibleSources?.typicalWeekend ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [weekendActivityDraft, serverProfile]);

  const travelDestinationValue = useMemo(() => {
    if (travelDestinationDraft !== null) {
      return travelDestinationDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      travelDestination?: string;
      dreamDestination?: string;
      favoriteDestination?: string;
    };
    const value =
      possibleSources?.travelDestination ??
      possibleSources?.dreamDestination ??
      possibleSources?.favoriteDestination ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [travelDestinationDraft, serverProfile]);

  const fitnessActivityValue = useMemo(() => {
    if (fitnessActivityDraft !== null) {
      return fitnessActivityDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      fitnessActivity?: string;
      workout?: string;
      exercise?: string;
    };
    const value =
      possibleSources?.fitnessActivity ??
      possibleSources?.workout ??
      possibleSources?.exercise ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [fitnessActivityDraft, serverProfile]);

  const educationValue = useMemo(() => {
    if (educationDraft !== null) {
      return educationDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      education?: string;
      educationLevel?: string;
      school?: string;
    };
    const value =
      possibleSources?.education ??
      possibleSources?.educationLevel ??
      possibleSources?.school ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [educationDraft, serverProfile]);

  const jobTitleValue = useMemo(() => {
    if (jobTitleDraft !== null) {
      return jobTitleDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      jobTitle?: string;
      occupation?: string;
      profession?: string;
      job?: string;
    };
    const value =
      possibleSources?.jobTitle ??
      possibleSources?.occupation ??
      possibleSources?.profession ??
      possibleSources?.job ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [jobTitleDraft, serverProfile]);

  const companyValue = useMemo(() => {
    if (companyDraft !== null) {
      return companyDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      company?: string;
      workplace?: string;
      employer?: string;
    };
    const value =
      possibleSources?.company ??
      possibleSources?.workplace ??
      possibleSources?.employer ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [companyDraft, serverProfile]);

  const lifePhilosophyValue = useMemo(() => {
    if (lifePhilosophyDraft !== null) {
      return lifePhilosophyDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      lifePhilosophy?: string;
      philosophy?: string;
      beliefs?: string;
      values?: string;
    };
    const value =
      possibleSources?.lifePhilosophy ??
      possibleSources?.philosophy ??
      possibleSources?.beliefs ??
      possibleSources?.values ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [lifePhilosophyDraft, serverProfile]);

  const communicationStyleValue = useMemo(() => {
    if (communicationStyleDraft !== null) {
      return communicationStyleDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      communicationStyle?: string;
      loveLanguage?: string;
      socialStyle?: string;
    };
    const value =
      possibleSources?.communicationStyle ??
      possibleSources?.loveLanguage ??
      possibleSources?.socialStyle ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [communicationStyleDraft, serverProfile]);

  const datingProConValue = useMemo(() => {
    if (datingProConDraft !== null) {
      return datingProConDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      datingProCon?: string;
      prosAndCons?: string;
      prosConsOfDatingMe?: string;
    };
    const value =
      possibleSources?.datingProCon ??
      possibleSources?.prosAndCons ??
      possibleSources?.prosConsOfDatingMe ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [datingProConDraft, serverProfile]);

  const loveLanguageValue = useMemo(() => {
    if (loveLanguageDraft !== null) {
      return loveLanguageDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      loveLanguage?: string;
      myLoveLanguage?: string;
      loveLanguages?: string;
    };
    const value =
      possibleSources?.loveLanguage ??
      possibleSources?.myLoveLanguage ??
      possibleSources?.loveLanguages ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [loveLanguageDraft, serverProfile]);

  const firstDateValue = useMemo(() => {
    if (firstDateDraft !== null) {
      return firstDateDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      firstDate?: string;
      idealFirstDate?: string;
      perfectFirstDate?: string;
    };
    const value =
      possibleSources?.firstDate ??
      possibleSources?.idealFirstDate ??
      possibleSources?.perfectFirstDate ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [firstDateDraft, serverProfile]);

  const greenFlagValue = useMemo(() => {
    if (greenFlagDraft !== null) {
      return greenFlagDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      greenFlag?: string;
      greenFlags?: string;
      myGreenFlag?: string;
    };
    const value =
      possibleSources?.greenFlag ??
      possibleSources?.greenFlags ??
      possibleSources?.myGreenFlag ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [greenFlagDraft, serverProfile]);

  const redFlagValue = useMemo(() => {
    if (redFlagDraft !== null) {
      return redFlagDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      redFlag?: string;
      redFlags?: string;
      dealBreaker?: string;
    };
    const value =
      possibleSources?.redFlag ??
      possibleSources?.redFlags ??
      possibleSources?.dealBreaker ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [redFlagDraft, serverProfile]);

  const seekingForValue = useMemo(() => {
    if (seekingForDraft !== null) {
      return seekingForDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      seekingFor?: string;
      seeking?: string;
      lookingForRelationship?: string;
    };
    const value =
      possibleSources?.seekingFor ??
      possibleSources?.seeking ??
      possibleSources?.lookingForRelationship ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [seekingForDraft, serverProfile]);

  const selfCareValue = useMemo(() => {
    if (selfCareDraft !== null) {
      return selfCareDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      selfCare?: string;
      selfCareIs?: string;
      mySelfCare?: string;
    };
    const value =
      possibleSources?.selfCare ??
      possibleSources?.selfCareIs ??
      possibleSources?.mySelfCare ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [selfCareDraft, serverProfile]);

  const simplePleasuresValue = useMemo(() => {
    if (simplePleasuresDraft !== null) {
      return simplePleasuresDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      simplePleasures?: string;
      mySimplePleasures?: string;
      simplePleasure?: string;
    };
    const value =
      possibleSources?.simplePleasures ??
      possibleSources?.mySimplePleasures ??
      possibleSources?.simplePleasure ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [simplePleasuresDraft, serverProfile]);

  const greatRelationshipValue = useMemo(() => {
    if (greatRelationshipDraft !== null) {
      return greatRelationshipDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      greatRelationship?: string;
      relationshipGreat?: string;
      whatMakesRelationshipGreat?: string;
    };
    const value =
      possibleSources?.greatRelationship ??
      possibleSources?.relationshipGreat ??
      possibleSources?.whatMakesRelationshipGreat ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [greatRelationshipDraft, serverProfile]);

  const relocationValue = useMemo(() => {
    if (relocationDraft !== null) {
      return normalizeRelocation(relocationDraft);
    }
    return normalizeRelocation(
      (serverProfile as unknown as { relocation?: string })?.relocation
    );
  }, [relocationDraft, serverProfile]);

  const nationalityValue = useMemo(() => {
    if (nationalityDraft !== null) {
      return nationalityDraft.trim();
    }
    const profileNationality = (
      serverProfile as unknown as {
        nationality?: string;
      }
    )?.nationality;
    const normalizedNationality =
      typeof profileNationality === "string" ? profileNationality.trim() : "";
    if (normalizedNationality) {
      return normalizedNationality;
    }
    const locationCountry =
      typeof serverProfile?.location?.country === "string"
        ? serverProfile.location.country.trim()
        : "";
    return locationCountry;
  }, [nationalityDraft, serverProfile]);

  const relationshipSelection = useMemo<string[]>(() => {
    if (relationshipDraft) {
      return toCanonicalRelationshipList(relationshipDraft);
    }
    const raw = serverProfile as unknown as {
      relationshipLookingFor?: string[] | string;
      relationshipPreference?: string[] | string;
      relationshipsLookingFor?: string[] | string;
      lookingFor?: string[] | string;
      relationship?: string[] | string;
      relationshipGoal?: string[] | string;
    };
    const collected: string[] = [];
    const add = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(add);
      } else if (typeof value === "string") {
        collected.push(value);
      }
    };
    if (raw) {
      add(raw.relationshipLookingFor);
      add(raw.relationshipPreference);
      add(raw.relationshipsLookingFor);
      add(raw.lookingFor);
      add(raw.relationship);
      add(raw.relationshipGoal);
    }
    return toCanonicalRelationshipList(collected);
  }, [relationshipDraft, serverProfile]);

  const relationshipDisplay = useMemo(() => {
    if (relationshipSelection.length === 0) return "";
    return relationshipSelection.join(", ");
  }, [relationshipSelection]);

  const profileHeadingValue = useMemo(() => {
    if (profileHeadingDraft !== null) {
      return profileHeadingDraft.trim();
    }
    const heading = (serverProfile as unknown as { mood?: string })?.mood;
    return typeof heading === "string" ? heading.trim() : "";
  }, [profileHeadingDraft, serverProfile]);

  const aboutValue = useMemo(() => {
    const possibleSources = serverProfile as unknown as {
      about?: string;
      aboutMe?: string;
      bio?: string;
      description?: string;
      summary?: string;
    };
    const value =
      possibleSources?.about ??
      possibleSources?.aboutMe ??
      possibleSources?.bio ??
      possibleSources?.description ??
      possibleSources?.summary ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [serverProfile]);

  const lookingForValue = useMemo(() => {
    if (lookingForDraft !== null) {
      return lookingForDraft.trim();
    }
    const possibleSources = serverProfile as unknown as {
      partnerLookingFor?: string;
      lookingForInPartner?: string;
      partnerPreferences?: string;
      partnerDescription?: string;
      preferences?: {
        partnerDescription?: string;
        lookingForInPartner?: string;
      };
    };
    const value =
      possibleSources?.partnerLookingFor ??
      possibleSources?.lookingForInPartner ??
      possibleSources?.partnerPreferences ??
      possibleSources?.partnerDescription ??
      possibleSources?.preferences?.partnerDescription ??
      possibleSources?.preferences?.lookingForInPartner ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [lookingForDraft, serverProfile]);

  const childrenValue = useMemo(() => {
    const choice = childrenSelection.choice;
    const count = childrenSelection.count.trim();
    if (!choice) return "";
    if (requiresChildrenCount(choice)) {
      const numeric = Number.parseInt(count, 10);
      const hasValidCount = Number.isFinite(numeric) && numeric > 0;
      if (!hasValidCount) {
        return choice;
      }

      const livesWithMe = !choice.toLowerCase().includes("don't");
      const quantityLabel = numeric === 1 ? "a child" : `${numeric} children`;
      const verbPhrase = (() => {
        if (numeric === 1) {
          return livesWithMe ? "who lives with me" : "who doesn't live with me";
        }
        return livesWithMe ? "who live with me" : "who don't live with me";
      })();

      return `I have ${quantityLabel} ${verbPhrase}`;
    }
    return choice;
  }, [childrenSelection]);

  const myBio = useMemo(
    () => [
      { label: "Introduce yourself", value: profileHeadingValue },
      { label: "About me", value: aboutValue },
    ],
    [profileHeadingValue, aboutValue]
  );

  const basics = useMemo(
    () => [
      { label: "First Name", value: firstNameValue },
      { label: "Lives in", value: formattedLocation },
      { label: "Gender", value: genderValue },
      { label: "Height", value: heightValue },
      { label: "Body type", value: bodyTypeValue },
      { label: "Age", value: ageValue },
    ],
    [
      firstNameValue,
      formattedLocation,
      genderValue,
      heightValue,
      bodyTypeValue,
      ageValue,
    ]
  );

  const lifestyle = useMemo(
    () => [
      { label: "Smoking", value: smokingValue },
      { label: "Drinking", value: drinkingValue },
      { label: "Kids", value: childrenValue },
      { label: "Open to relocating", value: relocationValue },
      { label: "Looking for", value: relationshipDisplay },
    ],
    [
      smokingValue,
      drinkingValue,
      childrenValue,
      relocationValue,
      relationshipDisplay,
    ]
  );

  const background = useMemo(
    () => [
      { label: "Education", value: educationValue },
      { label: "Job title", value: jobTitleValue },
      { label: "Company", value: companyValue },
      { label: "Nationality", value: nationalityValue },
      { label: "Religion", value: religionValue },
      { label: "My philosophy", value: lifePhilosophyValue },
      { label: "Communication style", value: communicationStyleValue },
    ],
    [
      educationValue,
      jobTitleValue,
      companyValue,
      nationalityValue,
      religionValue,
      lifePhilosophyValue,
      communicationStyleValue,
    ]
  );

  const interestsAndHobbies = useMemo(
    () => [
      {
        label: "I'm looking for",
        value: lookingForValue,
      },
      { label: "My go-to hobby", value: hobbyValue },
      { label: "Perfect weekend activity", value: weekendActivityValue },
      { label: "Dream travel destination", value: travelDestinationValue },
      { label: "How I stay active", value: fitnessActivityValue },
      { label: "My favorite movie", value: favoriteMovieValue },
      { label: "Music I vibe with", value: musicPreferenceValue },
      { label: "Food I can't resist", value: foodPreferenceValue },
      {
        label: "My ideal match",
        value: perfectMatchValue,
      },
    ],
    [
      lookingForValue,
      hobbyValue,
      weekendActivityValue,
      travelDestinationValue,
      fitnessActivityValue,
      favoriteMovieValue,
      musicPreferenceValue,
      foodPreferenceValue,
      perfectMatchValue,
    ]
  );

  const answerQuestions = useMemo(
    () => [
      { label: "Seeking for", value: seekingForValue },
      { label: "A pro and con of dating me", value: datingProConValue },
      { label: "My love language", value: loveLanguageValue },
      { label: "The perfect first date", value: firstDateValue },
      { label: "To me self-care is", value: selfCareValue },
      { label: "My simple pleasures are", value: simplePleasuresValue },
      {
        label: "What makes a relationship great",
        value: greatRelationshipValue,
      },
      { label: "A green flag I look for", value: greenFlagValue },
      { label: "A dealbreaker for me", value: redFlagValue },
    ],
    [
      seekingForValue,
      datingProConValue,
      loveLanguageValue,
      firstDateValue,
      selfCareValue,
      simplePleasuresValue,
      greatRelationshipValue,
      greenFlagValue,
      redFlagValue,
    ]
  );

  const renderActiveEditContent = () => {
    if (!activeEdit) return null;
    if (activeEdit.field === "First Name") {
      return (
        <EditFirstNameForm
          initialValue={firstNameValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Enter your first name.", 2500, "error");
              return;
            }
            setFirstNameDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              { displayName: trimmed, firstName: trimmed },
              {
                successMessage: "First name updated",
                onSuccessCallback: () => setFirstNameDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Lives in") {
      return (
        <EditLivesInForm
          initialValue={livesInSelection ?? createEmptyLocationSelection()}
          onCancel={() => setActiveEdit(null)}
          onSave={(selection) => {
            setLivesInDraft(selection);
            setActiveEdit(null);
            const locationPayload = selectionToGeoLocation(selection);
            void applyProfilePatch(
              { location: locationPayload },
              {
                successMessage: "Location updated",
                onSuccessCallback: () => setLivesInDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Gender") {
      return (
        <EditGenderForm
          initialValue={genderValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const normalized = normalizeGender(value);
            setGenderDraft(normalized);
            setActiveEdit(null);
            if (!normalized) {
              showToast("Select a gender to continue.", 2500, "error");
              return;
            }
            void applyProfilePatch(
              { gender: normalized },
              {
                successMessage: "Gender updated",
                onSuccessCallback: () => setGenderDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Height") {
      return (
        <EditHeightForm
          initialValue={heightValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const normalized = normalizeHeight(value);
            setHeightDraft(normalized);
            setActiveEdit(null);
            if (!normalized) {
              showToast("Select a height to continue.", 2500, "error");
              return;
            }
            void applyProfilePatch(
              { height: normalized },
              {
                successMessage: "Height updated",
                onSuccessCallback: () => setHeightDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Body type") {
      return (
        <EditBodyTypeForm
          initialValue={bodyTypeValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const normalized = normalizeBodyType(value);
            setBodyTypeDraft(normalized);
            setActiveEdit(null);
            if (!normalized) {
              showToast("Select a body type to continue.", 2500, "error");
              return;
            }
            void applyProfilePatch(
              { bodyType: normalized },
              {
                successMessage: "Body type updated",
                onSuccessCallback: () => setBodyTypeDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Age") {
      return (
        <EditAgeForm
          initialValue={ageValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const normalized = value.trim();
            const parsed = Number.parseInt(normalized, 10);
            if (!Number.isFinite(parsed) || parsed < 18 || parsed > 120) {
              showToast("Enter an age between 18 and 120.", 2500, "error");
              return;
            }
            setAgeDraft(normalized);
            setActiveEdit(null);
            void applyProfilePatch(
              { age: parsed },
              {
                successMessage: "Age updated",
                onSuccessCallback: () => setAgeDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Introduce yourself") {
      return (
        <EditProfileHeadingForm
          initialValue={profileHeadingValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Add a short headline to continue.", 2500, "error");
              return;
            }
            setProfileHeadingDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              { mood: trimmed },
              {
                successMessage: "Profile heading updated",
                onSuccessCallback: () => setProfileHeadingDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "I'm looking for") {
      return (
        <EditPartnerLookingForForm
          initialValue={lookingForValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share what you're looking for.", 2500, "error");
              return;
            }
            setLookingForDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                partnerLookingFor: trimmed,
                lookingForInPartner: trimmed,
                partnerDescription: trimmed,
              },
              {
                successMessage: "Preferences updated",
                onSuccessCallback: () => setLookingForDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "My favorite movie") {
      return (
        <EditFavoriteMovieForm
          initialValue={favoriteMovieValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share your favorite movie.", 2500, "error");
              return;
            }
            setFavoriteMovieDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              { favoriteMovie: trimmed },
              {
                successMessage: "Favorite movie updated",
                onSuccessCallback: () => setFavoriteMovieDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Music I vibe with") {
      return (
        <EditMusicPreferenceForm
          initialValue={musicPreferenceValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share your music taste.", 2500, "error");
              return;
            }
            setMusicPreferenceDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                favoriteMusic: trimmed,
                musicPreference: trimmed,
                musicPreferences: trimmed,
              },
              {
                successMessage: "Music preference updated",
                onSuccessCallback: () => setMusicPreferenceDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Food I can't resist") {
      return (
        <EditFoodPreferenceForm
          initialValue={foodPreferenceValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share your food preferences.", 2500, "error");
              return;
            }
            setFoodPreferenceDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                favoriteFood: trimmed,
                foodPreference: trimmed,
                foodPreferences: trimmed,
              },
              {
                successMessage: "Food preference updated",
                onSuccessCallback: () => setFoodPreferenceDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "My ideal match") {
      return (
        <EditPerfectMatchForm
          initialValue={perfectMatchValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Describe your ideal match.", 2500, "error");
              return;
            }
            setPerfectMatchDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                perfectMatchDescription: trimmed,
                perfectMatch: trimmed,
                idealPartner: trimmed,
              },
              {
                successMessage: "Ideal match updated",
                onSuccessCallback: () => setPerfectMatchDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "My go-to hobby") {
      return (
        <EditHobbyForm
          initialValue={hobbyValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share your favorite hobby.", 2500, "error");
              return;
            }
            setHobbyDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                hobby: trimmed,
                hobbies: trimmed,
                favoriteHobby: trimmed,
              },
              {
                successMessage: "Hobby updated",
                onSuccessCallback: () => setHobbyDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Perfect weekend activity") {
      return (
        <EditWeekendActivityForm
          initialValue={weekendActivityValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share your weekend plans.", 2500, "error");
              return;
            }
            setWeekendActivityDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                weekendActivity: trimmed,
                weekendActivities: trimmed,
                typicalWeekend: trimmed,
              },
              {
                successMessage: "Weekend activity updated",
                onSuccessCallback: () => setWeekendActivityDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Dream travel destination") {
      return (
        <EditTravelDestinationForm
          initialValue={travelDestinationValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share your dream destination.", 2500, "error");
              return;
            }
            setTravelDestinationDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                travelDestination: trimmed,
                dreamDestination: trimmed,
                favoriteDestination: trimmed,
              },
              {
                successMessage: "Travel destination updated",
                onSuccessCallback: () => setTravelDestinationDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "How I stay active") {
      return (
        <EditFitnessActivityForm
          initialValue={fitnessActivityValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share how you stay active.", 2500, "error");
              return;
            }
            setFitnessActivityDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                fitnessActivity: trimmed,
                workout: trimmed,
                exercise: trimmed,
              },
              {
                successMessage: "Fitness activity updated",
                onSuccessCallback: () => setFitnessActivityDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Smoking") {
      return (
        <EditSmokingForm
          initialValue={smokingValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const normalized = normalizeSmoking(value);
            if (!normalized) {
              showToast("Select a smoking preference.", 2500, "error");
              return;
            }
            setSmokingDraft(normalized);
            setActiveEdit(null);
            void applyProfilePatch(
              { smoking: normalized },
              {
                successMessage: "Smoking preference updated",
                onSuccessCallback: () => setSmokingDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Drinking") {
      return (
        <EditDrinkingForm
          initialValue={drinkingValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const normalized = normalizeDrinking(value);
            if (!normalized) {
              showToast("Select a drinking preference.", 2500, "error");
              return;
            }
            setDrinkingDraft(normalized);
            setActiveEdit(null);
            void applyProfilePatch(
              { drinking: normalized },
              {
                successMessage: "Drinking preference updated",
                onSuccessCallback: () => setDrinkingDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Religion") {
      return (
        <EditReligionForm
          initialValue={religionValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const normalized = normalizeReligion(value);
            if (!normalized) {
              showToast("Select or enter a religion.", 2500, "error");
              return;
            }
            setReligionDraft(normalized);
            setActiveEdit(null);
            void applyProfilePatch(
              { religion: normalized },
              {
                successMessage: "Religion updated",
                onSuccessCallback: () => setReligionDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Education") {
      return (
        <EditEducationForm
          initialValue={educationValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Select your education level.", 2500, "error");
              return;
            }
            setEducationDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                education: trimmed,
                educationLevel: trimmed,
                school: trimmed,
              },
              {
                successMessage: "Education updated",
                onSuccessCallback: () => setEducationDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Job title") {
      return (
        <EditJobTitleForm
          initialValue={jobTitleValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Enter your job title.", 2500, "error");
              return;
            }
            setJobTitleDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                jobTitle: trimmed,
                occupation: trimmed,
                job: trimmed,
              },
              {
                successMessage: "Job title updated",
                onSuccessCallback: () => setJobTitleDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Company") {
      return (
        <EditCompanyForm
          initialValue={companyValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Enter your company.", 2500, "error");
              return;
            }
            setCompanyDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                company: trimmed,
                workplace: trimmed,
                employer: trimmed,
              },
              {
                successMessage: "Company updated",
                onSuccessCallback: () => setCompanyDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "My philosophy") {
      return (
        <EditLifePhilosophyForm
          initialValue={lifePhilosophyValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share your life philosophy.", 2500, "error");
              return;
            }
            setLifePhilosophyDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                lifePhilosophy: trimmed,
                philosophy: trimmed,
                outlook: trimmed,
              },
              {
                successMessage: "Philosophy updated",
                onSuccessCallback: () => setLifePhilosophyDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Communication style") {
      return (
        <EditCommunicationStyleForm
          initialValue={communicationStyleValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Select your communication style.", 2500, "error");
              return;
            }
            setCommunicationStyleDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                communicationStyle: trimmed,
                communicationPreference: trimmed,
                howToCommunicate: trimmed,
              },
              {
                successMessage: "Communication style updated",
                onSuccessCallback: () => setCommunicationStyleDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "A pro and con of dating me") {
      return (
        <EditDatingProConForm
          initialValue={datingProConValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share a pro and con.", 2500, "error");
              return;
            }
            setDatingProConDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                datingProCon: trimmed,
                prosAndCons: trimmed,
                prosConsOfDatingMe: trimmed,
              },
              {
                successMessage: "Pro and con updated",
                onSuccessCallback: () => setDatingProConDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "My love language") {
      return (
        <EditLoveLanguageForm
          initialValue={loveLanguageValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share your love language.", 2500, "error");
              return;
            }
            setLoveLanguageDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                loveLanguage: trimmed,
                myLoveLanguage: trimmed,
                loveLanguages: trimmed,
              },
              {
                successMessage: "Love language updated",
                onSuccessCallback: () => setLoveLanguageDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "The perfect first date") {
      return (
        <EditFirstDateForm
          initialValue={firstDateValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Describe your ideal first date.", 2500, "error");
              return;
            }
            setFirstDateDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                firstDate: trimmed,
                idealFirstDate: trimmed,
                perfectFirstDate: trimmed,
              },
              {
                successMessage: "First date updated",
                onSuccessCallback: () => setFirstDateDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "A green flag I look for") {
      return (
        <EditGreenFlagForm
          initialValue={greenFlagValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share a green flag.", 2500, "error");
              return;
            }
            setGreenFlagDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                greenFlag: trimmed,
                greenFlags: trimmed,
                myGreenFlag: trimmed,
              },
              {
                successMessage: "Green flag updated",
                onSuccessCallback: () => setGreenFlagDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "A dealbreaker for me") {
      return (
        <EditRedFlagForm
          initialValue={redFlagValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share a dealbreaker.", 2500, "error");
              return;
            }
            setRedFlagDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                redFlag: trimmed,
                redFlags: trimmed,
                dealBreaker: trimmed,
              },
              {
                successMessage: "Dealbreaker updated",
                onSuccessCallback: () => setRedFlagDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Seeking for") {
      return (
        <EditSeekingForForm
          initialValue={seekingForValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share what you're seeking.", 2500, "error");
              return;
            }
            setSeekingForDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                seekingFor: trimmed,
                seeking: trimmed,
                lookingForRelationship: trimmed,
              },
              {
                successMessage: "Seeking preference updated",
                onSuccessCallback: () => setSeekingForDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "To me self-care is") {
      return (
        <EditSelfCareForm
          initialValue={selfCareValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share your self-care approach.", 2500, "error");
              return;
            }
            setSelfCareDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                selfCare: trimmed,
                selfCareIs: trimmed,
                mySelfCare: trimmed,
              },
              {
                successMessage: "Self-care updated",
                onSuccessCallback: () => setSelfCareDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "My simple pleasures are") {
      return (
        <EditSimplePleasuresForm
          initialValue={simplePleasuresValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Share your simple pleasures.", 2500, "error");
              return;
            }
            setSimplePleasuresDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                simplePleasures: trimmed,
                mySimplePleasures: trimmed,
                simplePleasure: trimmed,
              },
              {
                successMessage: "Simple pleasures updated",
                onSuccessCallback: () => setSimplePleasuresDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "What makes a relationship great") {
      return (
        <EditGreatRelationshipForm
          initialValue={greatRelationshipValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast(
                "Share what makes a relationship great.",
                2500,
                "error"
              );
              return;
            }
            setGreatRelationshipDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                greatRelationship: trimmed,
                relationshipGreat: trimmed,
                whatMakesRelationshipGreat: trimmed,
              },
              {
                successMessage: "Relationship view updated",
                onSuccessCallback: () => setGreatRelationshipDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Kids") {
      return (
        <EditChildrenForm
          initialValue={childrenSelection}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const choice = normalizeChildren(value.choice);
            const rawCount = value.count?.trim() ?? "";
            const parsedCount = rawCount ? Number.parseInt(rawCount, 10) : null;
            if (
              requiresChildrenCount(choice) &&
              (!parsedCount || parsedCount <= 0)
            ) {
              showToast("Enter how many children you have.", 2500, "error");
              return;
            }
            setChildrenDraft({
              choice,
              count: rawCount,
            });
            setActiveEdit(null);
            void applyProfilePatch(
              {
                children: choice || null,
                childrenCount:
                  parsedCount !== null && Number.isFinite(parsedCount)
                    ? Math.max(0, parsedCount)
                    : null,
              },
              {
                successMessage: "Family info updated",
                onSuccessCallback: () => setChildrenDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Open to relocating") {
      return (
        <EditRelocationForm
          initialValue={relocationValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const normalized = normalizeRelocation(value);
            if (!normalized) {
              showToast("Select a relocation preference.", 2500, "error");
              return;
            }
            setRelocationDraft(normalized);
            setActiveEdit(null);
            void applyProfilePatch(
              { relocation: normalized },
              {
                successMessage: "Relocation preference updated",
                onSuccessCallback: () => setRelocationDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Nationality") {
      return (
        <EditNationalityForm
          initialValue={nationalityValue}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              showToast("Select a nationality.", 2500, "error");
              return;
            }
            setNationalityDraft(trimmed);
            setActiveEdit(null);
            void applyProfilePatch(
              { nationality: trimmed },
              {
                successMessage: "Nationality updated",
                onSuccessCallback: () => setNationalityDraft(null),
              }
            );
          }}
        />
      );
    }
    if (activeEdit.field === "Looking for") {
      return (
        <EditRelationshipForm
          initialValue={relationshipSelection}
          onCancel={() => setActiveEdit(null)}
          onSave={(value) => {
            const canonical = toCanonicalRelationshipList(value);
            if (!canonical.length) {
              showToast(
                "Select at least one relationship goal.",
                2500,
                "error"
              );
              return;
            }
            setRelationshipDraft(canonical);
            setActiveEdit(null);
            void applyProfilePatch(
              {
                relationshipLookingFor: canonical,
                relationshipPreference: canonical,
                relationshipsLookingFor: canonical,
              },
              {
                successMessage: "Relationship goal updated",
                onSuccessCallback: () => setRelationshipDraft(null),
              }
            );
          }}
        />
      );
    }
    return (
      <p className="text-sm text-gray-500">
        Editing UI for {activeEdit.field} will appear here soon.
      </p>
    );
  };

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex flex-col bg-white"
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <header className="flex h-12 items-center justify-between gap-4 px-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center justify-center"
          aria-label="Go back"
        >
          <ArrowLeft size={24} className="text-gray-900" />
        </button>
        <h1 className="text-lg font-semibold text-gray-900">
          Edit dating profile
        </h1>
        <div className="w-6" aria-hidden="true" />
      </header>

      <main
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-6"
        data-scroll-container
      >
        <div className="mx-auto w-full max-w-md pb-12">
          <div className="mt-6">
            <SectionGroup
              title="My Bio"
              items={myBio}
              sectionId="my-bio"
              isHighlighted={highlightedSection === "my-bio"}
              highlightKey={
                highlightedSection === "my-bio" ? highlightToken : undefined
              }
              onEdit={handleStartEdit}
            />
            <SectionGroup
              title="Basics"
              items={basics}
              showTopDivider
              sectionId="basics"
              isHighlighted={highlightedSection === "basics"}
              highlightKey={
                highlightedSection === "basics" ? highlightToken : undefined
              }
              onEdit={handleStartEdit}
            />
            <SectionGroup
              title="Lifestyle"
              items={lifestyle}
              showTopDivider
              sectionId="lifestyle"
              isHighlighted={highlightedSection === "lifestyle"}
              highlightKey={
                highlightedSection === "lifestyle" ? highlightToken : undefined
              }
              onEdit={handleStartEdit}
            />
            <SectionGroup
              title="Background"
              items={background}
              showTopDivider
              sectionId="background"
              isHighlighted={highlightedSection === "background"}
              highlightKey={
                highlightedSection === "background" ? highlightToken : undefined
              }
              onEdit={handleStartEdit}
            />
            <SectionGroup
              title="My Interests & Hobbies"
              items={interestsAndHobbies}
              showTopDivider
              sectionId="interests"
              isHighlighted={highlightedSection === "interests"}
              highlightKey={
                highlightedSection === "interests" ? highlightToken : undefined
              }
              onEdit={handleStartEdit}
            />
            <SectionGroup
              title="Answer Questions"
              items={answerQuestions}
              showTopDivider
              sectionId="answer-questions"
              isHighlighted={highlightedSection === "answer-questions"}
              highlightKey={
                highlightedSection === "answer-questions"
                  ? highlightToken
                  : undefined
              }
              onEdit={handleStartEdit}
            />
          </div>
        </div>
      </main>

      <FullscreenOverlay
        isOpen={activeEdit !== null}
        onClose={() => setActiveEdit(null)}
        className="bg-white"
      >
        <div className="flex min-h-full flex-col">
          <header className="sticky top-0 z-10 flex h-12 items-center justify-between bg-white px-4">
            <button
              type="button"
              onClick={() => setActiveEdit(null)}
              className="flex items-center justify-center"
              aria-label="Go back"
            >
              <ArrowLeft size={24} className="text-gray-900" />
            </button>
            <h2 className="text-base font-semibold text-gray-900">
              {activeEdit?.group ?? ""}
            </h2>
            <div className="w-6" aria-hidden />
          </header>
          <div className="flex-1 px-4 py-6">{renderActiveEditContent()}</div>
        </div>
      </FullscreenOverlay>
      <SuccessToast
        key={successToastState.id}
        open={isSuccessToastOpen}
        message={successToastState.message}
        onClose={closeSuccessToast}
      />
    </motion.div>
  );
};

export default EditDatingProfileProfile;
