import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Cake,
  GenderIntersex,
  MagnifyingGlass,
  MapPin,
  PersonSimple,
  PencilSimple,
  Plus,
  Ruler,
  User,
} from "phosphor-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import {
  fetchDatingProfile,
  removeDatingPhoto,
  saveDatingProfile,
  uploadDatingPhoto,
} from "../services/api";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import SuccessToast from "../components/ui/SuccessToast";
import type { DatingProfile } from "../types";
import { toCanonicalRelationshipList } from "../utils/relationshipPreferences";
import PageHeader from "../components/common/PageHeader";
import { useSocketStore } from "../stores/socketStore";
import PhotoDragDrop, {
  type PhotoDragDropAssignments,
  type PhotoDragDropPhoto,
  type PhotoDragDropProps,
  type PhotoDragDropSection,
  PHOTO_DRAG_DROP_AVAILABLE_ID,
} from "../components/PhotoDragDrop";
import { datingProfilesKey } from "../hooks/useDatingProfilesQuery";
import { broadcastMessage } from "../lib/broadcast";

type DatingProfileRouteState = {
  profile?: DatingProfile;
  allowEdit?: boolean;
  preview?: boolean;
  hideTitle?: boolean;
};

type DatingProfilePageProps = {
  allowEdit?: boolean;
  hideTitle?: boolean;
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

const normalizeSmoking = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower === "do smoke" || lower === "smoker") return "Do smoke";
  if (
    lower === "dont smoke" ||
    lower === "don't smoke" ||
    lower === "non smoker"
  )
    return "Don't smoke";
  if (lower === "occasionally smoke" || lower === "occasional smoker")
    return "Occasionally smoke";
  return trimmed;
};

const normalizeDrinking = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower === "do drink" || lower === "drinker") return "Do drink";
  if (
    lower === "dont drink" ||
    lower === "don't drink" ||
    lower === "non drinker"
  )
    return "Don't drink";
  if (lower === "occasionally drink" || lower === "occasional drinker")
    return "Occasionally drink";
  return trimmed;
};

const normalizeChildren = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower === "no" || lower === "none") return "No";
  if (
    lower.includes("don't live") ||
    lower.includes("dont live") ||
    lower.includes("separate")
  )
    return "Yes - we don't live together";
  if (lower.includes("live together") || lower.includes("same home"))
    return "Yes - we live together";
  return trimmed;
};

const normalizeRelocation = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower.includes("within") && lower.includes("country"))
    return "Willing to relocate within my country";
  if (lower.includes("another country") || lower.includes("abroad"))
    return "Willing to relocate to another country";
  if (lower.startsWith("not") && lower.includes("willing"))
    return "Not willing to relocate";
  if (lower.includes("not sure") || lower.includes("unsure"))
    return "Not sure about relocating";
  return trimmed;
};

const normalizeReligion = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const options = [
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
  ];
  const match = options.find((option) => option.toLowerCase() === lower);
  if (match) return match;
  if (lower.includes("spiritual")) return "Spiritual but not religious";
  if (lower.includes("atheist")) return "Atheist";
  if (lower.includes("agnostic")) return "Agnostic";
  return trimmed;
};

const requiresChildrenCount = (value: string): boolean =>
  value.trim().toLowerCase().startsWith("yes");

const extractChildrenCount = (value: string | null | undefined): string => {
  if (!value) return "";
  const match = String(value).match(/(\d+)/);
  return match ? match[1] : "";
};

const joinLocation = (profile: DatingProfile | null): string => {
  if (!profile?.location) {
    return "";
  }
  const { city, state, country, formatted } = profile.location;
  const parts = [city, state, country]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0);
  if (parts.length) {
    return parts.join(", ");
  }
  return typeof formatted === "string" ? formatted.trim() : "";
};

type SectionItem = {
  label: string;
  value?: string | null;
  icon?: React.ReactNode;
  variant?: "pill-list" | "paragraph";
};

const SECTION_EDIT_TARGETS = {
  bio: "my-bio",
  basics: "basics",
  lifestyle: "lifestyle",
  background: "background",
  interests: "interests",
  conversation: "answer-questions",
} as const;

type SectionEditKey = keyof typeof SECTION_EDIT_TARGETS;

const SECTION_EMPTY_HINTS: Record<SectionEditKey, string> = {
  bio: "Add a quick intro so people feel like they already know you.",
  basics: "Add a few quick essentials so matches get the basics at a glance.",
  lifestyle:
    "Share how you live day to day—habits, plans, and what you’re open to next.",
  background:
    "Let people know where you’re from to spark easy conversation starters.",
  interests:
    "Share what you love doing to help matches find common ground with you.",
  conversation:
    "Answer a prompt to let your personality shine through at first glance.",
};

const hasAnswerValue = (value?: string | null): boolean =>
  typeof value === "string" && value.trim().length > 0;

type SectionBlockProps = {
  title: string;
  items: SectionItem[];
  showEditButton?: boolean;
  onEdit?: () => void;
  editLabel?: string;
  emptyHint?: string;
  hideIfEmpty?: boolean;
};

const SectionBlock: React.FC<SectionBlockProps> = ({
  title,
  items,
  showEditButton,
  onEdit,
  editLabel,
  emptyHint,
  hideIfEmpty,
}) => {
  const visibleItems = items.filter((item) => hasAnswerValue(item.value));
  const hasVisibleItems = visibleItems.length > 0;

  if (!hasVisibleItems && hideIfEmpty) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {showEditButton ? (
          <button
            type="button"
            onClick={onEdit}
            disabled={!onEdit}
            aria-label={editLabel ?? `Edit ${title}`}
            className="inline-flex items-center justify-center rounded-full text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PencilSimple size={22} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {hasVisibleItems ? (
        <div className="space-y-4">
          {visibleItems.map((item, index) => {
            const key = item.label || `item-${index}`;
            const answer = (item.value ?? "").trim();

            if (item.icon) {
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-gray-500">{item.icon}</span>
                  <p className="text-base text-gray-900">{answer}</p>
                </div>
              );
            }

            if (item.variant === "pill-list") {
              const pills = answer
                .split(",")
                .map((pill) => pill.trim())
                .filter(Boolean);

              return (
                <div key={key} className="space-y-1">
                  <p className="text-sm font-medium text-gray-500">
                    {item.label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {pills.length ? (
                      pills.map((pill, pillIndex) => (
                        <span
                          key={`${pill}-${pillIndex}`}
                          className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700"
                        >
                          <MagnifyingGlass
                            size={14}
                            aria-hidden="true"
                            className="text-gray-500"
                          />
                          {pill}
                        </span>
                      ))
                    ) : (
                      <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
                        <MagnifyingGlass
                          size={14}
                          aria-hidden="true"
                          className="text-gray-500"
                        />
                        {answer}
                      </span>
                    )}
                  </div>
                </div>
              );
            }

            if (item.variant === "paragraph") {
              return (
                <div key={key} className="space-y-1">
                  <p className="text-base text-gray-900 whitespace-pre-line">
                    {answer}
                  </p>
                </div>
              );
            }

            return (
              <div key={key} className="space-y-1">
                <p className="text-sm font-medium text-gray-500">
                  {item.label}
                </p>
                <p className="text-base text-gray-900">{answer}</p>
              </div>
            );
          })}
        </div>
      ) : emptyHint ? (
        <p className="text-sm text-gray-500">{emptyHint}</p>
      ) : null}
    </section>
  );
};

const normalizePhotoPlacementsForDisplay = (
  raw: Record<string, unknown> | null | undefined,
  photoIds: ReadonlySet<string>,
  sectionIds: ReadonlySet<string>
): PhotoDragDropAssignments => {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const normalized: PhotoDragDropAssignments = {};

  for (const [photoId, value] of Object.entries(raw)) {
    if (!photoIds.has(photoId)) {
      continue;
    }
    if (typeof value !== "string") {
      continue;
    }
    const sectionId = value.trim();
    if (!sectionId || !sectionIds.has(sectionId)) {
      continue;
    }
    normalized[photoId] = sectionId;
  }

  return normalized;
};

const placementMapsEqual = (
  a: PhotoDragDropAssignments,
  b: PhotoDragDropAssignments
): boolean => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
};

const MAX_SECONDARY_PHOTOS = 5;

const DatingProfilePage: React.FC<DatingProfilePageProps> = ({
  hideTitle,
  allowEdit,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ userId?: string }>();
  const { userId: authUserId, username: authUsername, joined } = useAuthStore();
  const routeState = (location.state ?? {}) as DatingProfileRouteState;
  const fallbackProfileUsername =
    typeof routeState.profile?.username === "string"
      ? routeState.profile.username
      : undefined;
  const fallbackProfileUserId =
    typeof routeState.profile?.userId === "string"
      ? routeState.profile.userId.trim()
      : undefined;
  const paramUserId =
    typeof params.userId === "string" && params.userId.trim()
      ? params.userId.trim()
      : undefined;
  const targetUserId =
    paramUserId ?? fallbackProfileUserId ?? (authUserId?.trim() || null);
  const targetUsername =
    fallbackProfileUsername ?? (authUsername ? authUsername.trim() : null);
  const queryClient = useQueryClient();
  const showToast = useUiStore((state) => state.showToast);
  const broadcastDatingProfileUpdate = useSocketStore(
    (state) => state.broadcastDatingProfileUpdate
  );

  const profileQueryKey = useMemo(
    () =>
      targetUserId ??
      (targetUsername ? `username:${targetUsername.toLowerCase()}` : "unknown"),
    [targetUserId, targetUsername]
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["datingProfile", profileQueryKey],
    queryFn: () =>
      fetchDatingProfile(
        targetUserId
          ? { userId: targetUserId }
          : { username: String(targetUsername) }
      ),
    enabled: Boolean(targetUserId || targetUsername),
  });

  const profileFromState = routeState.profile;
  const [profile, setProfile] = useState<DatingProfile | null>(() => {
    if (profileFromState) return profileFromState;
    if (data !== undefined) return data;
    return null;
  });

  const setProfileCache = useCallback(
    (nextProfile: DatingProfile | null) => {
      queryClient.setQueryData(["datingProfile", profileQueryKey], nextProfile);
      const nextId = nextProfile?.userId;
      if (nextId && nextId !== profileQueryKey) {
        queryClient.setQueryData(["datingProfile", nextId], nextProfile);
      }
    },
    [profileQueryKey, queryClient]
  );

  const authUsernameLower = authUsername ? authUsername.toLowerCase() : null;
  const authUserIdValue = authUserId ? authUserId.trim() : null;
  const profileUsernameLower =
    typeof profile?.username === "string"
      ? profile.username.toLowerCase()
      : null;
  const profileUserIdValue =
    typeof profile?.userId === "string" ? profile.userId.trim() : null;

  const viewingOwnProfile = useMemo(() => {
    if (authUserIdValue) {
      const candidateUserId =
        paramUserId ?? profileUserIdValue ?? fallbackProfileUserId ?? null;
      if (candidateUserId && candidateUserId === authUserIdValue) {
        return true;
      }
      if (!paramUserId && !fallbackProfileUserId && !profileUserIdValue) {
        return true;
      }
    }
    if (authUsernameLower) {
      if (profileUsernameLower && authUsernameLower === profileUsernameLower) {
        return true;
      }
      const fallbackLower = fallbackProfileUsername
        ? fallbackProfileUsername.toLowerCase()
        : null;
      if (fallbackLower && authUsernameLower === fallbackLower) {
        return true;
      }
    }
    return false;
  }, [
    authUserIdValue,
    authUsernameLower,
    fallbackProfileUserId,
    fallbackProfileUsername,
    paramUserId,
    profileUserIdValue,
    profileUsernameLower,
  ]);

  useEffect(() => {
    if (joined === false && viewingOwnProfile) {
      navigate("/", { replace: true });
    }
  }, [joined, navigate, viewingOwnProfile]);

  useEffect(() => {
    if (profileFromState) {
      setProfile(profileFromState);
      setProfileCache(profileFromState);
    }
  }, [profileFromState, setProfileCache]);

  useEffect(() => {
    if (data !== undefined) {
      setProfile(data);
      setProfileCache(data ?? null);
    }
  }, [data, setProfileCache]);

  const allowEditFromState = routeState.allowEdit;
  const previewFromState = routeState.preview;

  const canManagePhotos = useMemo(() => {
    if (typeof allowEdit === "boolean") return allowEdit;
    if (typeof allowEditFromState === "boolean") return allowEditFromState;
    if (previewFromState) return true;
    if (viewingOwnProfile) return true;
    return false;
  }, [allowEdit, allowEditFromState, previewFromState, viewingOwnProfile]);

  const primaryPhoto = useMemo(() => {
    if (!profile) return "";
    const pick = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    };

    return (
      pick(profile.photoUrl) ||
      pick(profile.photo) ||
      (Array.isArray(profile.photos)
        ? profile.photos
            .map(pick)
            .find((value): value is string => Boolean(value))
        : null) ||
      ""
    );
  }, [profile]);

  const secondaryPhotos = useMemo(() => {
    if (!profile) return [] as string[];
    const seen = new Set<string>();
    const results: string[] = [];
    const primary = primaryPhoto;
    const push = (value: unknown) => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (!trimmed || trimmed === primary) return;
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        results.push(trimmed);
      }
    };

    if (Array.isArray(profile.photos)) {
      for (const value of profile.photos) push(value);
    }

    push(profile.photo);
    push(profile.photoUrl);

    return results.slice(0, MAX_SECONDARY_PHOTOS);
  }, [primaryPhoto, profile]);

  const canAddMorePhotos = secondaryPhotos.length < MAX_SECONDARY_PHOTOS;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMode, setUploadMode] = useState<"add" | "replace-primary">(
    "add"
  );
  const [pendingSecondaryId, setPendingSecondaryId] = useState<string | null>(
    null
  );
  const [pendingSecondaryPreview, setPendingSecondaryPreview] = useState<
    string | null
  >(null);
  const [isSuccessToastOpen, setIsSuccessToastOpen] = useState(false);
  const [successToastState, setSuccessToastState] = useState({
    message: "",
    id: 0,
    duration: 2200,
  });
  const openSuccessToast = useCallback((message: string, duration = 2200) => {
    setSuccessToastState({ message, id: Date.now(), duration });
    setIsSuccessToastOpen(true);
  }, []);

  const closeSuccessToast = useCallback(() => {
    setIsSuccessToastOpen(false);
  }, []);
  const isPrimaryUpload = useMemo(
    () =>
      isUploading &&
      (uploadMode === "replace-primary" ||
        (!primaryPhoto && uploadMode === "add")),
    [isUploading, primaryPhoto, uploadMode]
  );
  const isSecondaryUploadInProgress = isUploading && !isPrimaryUpload;

  const addPhotoButtonText = primaryPhoto
    ? canAddMorePhotos
      ? "Add photo"
      : "Gallery full"
    : "Upload photo";
  const addPhotoButtonAriaLabel = isSecondaryUploadInProgress
    ? "Uploading photo"
    : addPhotoButtonText;
  const galleryPhotos = secondaryPhotos;
  const dragDropPhotos = useMemo<PhotoDragDropPhoto[]>(
    () =>
      galleryPhotos.map((src, index) => ({
        id: src,
        src,
        alt: `Dating profile photo ${index + 1}`,
      })),
    [galleryPhotos]
  );

  const [deletingPhotoIds, setDeletingPhotoIds] = useState<Set<string>>(
    () => new Set()
  );

  const photoIdSet = useMemo(
    () => new Set(dragDropPhotos.map((photo) => photo.id)),
    [dragDropPhotos]
  );

  const handleAddPhotoClick = useCallback(() => {
    if (isUploading) return;
    setUploadMode("add");
    if (!canAddMorePhotos) {
      showToast(
        `You can upload up to ${MAX_SECONDARY_PHOTOS} gallery photos.`,
        2800,
        "neutral"
      );
      return;
    }
    fileInputRef.current?.click();
  }, [canAddMorePhotos, isUploading, showToast]);

  const handleChangePrimaryPhotoClick = useCallback(() => {
    if (isUploading) return;
    setUploadMode("replace-primary");
    fileInputRef.current?.click();
  }, [isUploading]);

  const handleFileInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0] ?? null;
      input.value = "";
      if (!file) {
        setUploadMode("add");
        return;
      }
      const shouldSetPrimary =
        uploadMode === "replace-primary" || !primaryPhoto;

      if (!shouldSetPrimary && !canAddMorePhotos) {
        showToast(
          `You can upload up to ${MAX_SECONDARY_PHOTOS} gallery photos.`,
          2800,
          "neutral"
        );
        return;
      }
      if (!authUsername) {
        showToast("Please sign in to upload photos.", 2500, "error");
        return;
      }
      if (!file.type.toLowerCase().startsWith("image/")) {
        showToast("Please choose an image file.", 3000, "error");
        return;
      }
      const MAX_SIZE_BYTES = 10 * 1024 * 1024;
      if (file.size > MAX_SIZE_BYTES) {
        showToast("Photo must be 10MB or smaller.", 3000, "error");
        return;
      }

      setIsUploading(true);
      let previewUrl: string | null = null;
      if (!shouldSetPrimary) {
        previewUrl = URL.createObjectURL(file);
        setPendingSecondaryPreview((previous) => {
          if (previous) {
            URL.revokeObjectURL(previous);
          }
          return previewUrl;
        });
        setPendingSecondaryId("__pending-secondary__");
      }
      try {
        const { url } = await uploadDatingPhoto(file, String(authUsername));
        const previousPrimary = primaryPhoto || null;
        const dedupe = (values: string[]) => {
          const seen = new Set<string>();
          const ordered: string[] = [];
          for (const value of values) {
            if (!seen.has(value)) {
              seen.add(value);
              ordered.push(value);
            }
          }
          return ordered;
        };

        let nextPrimary = previousPrimary;
        let nextSecondary: string[] = [];

        if (shouldSetPrimary) {
          nextPrimary = url;
          nextSecondary = dedupe(
            secondaryPhotos.filter((value) => value !== url)
          ).slice(0, MAX_SECONDARY_PHOTOS);
        } else {
          const baseSecondary = [
            ...secondaryPhotos.filter((value) => value !== url),
            url,
          ];
          nextSecondary = dedupe(baseSecondary).slice(0, MAX_SECONDARY_PHOTOS);
        }

        const updatedProfile = await saveDatingProfile({
          username: String(authUsername),
          photos: nextSecondary,
          photoUrl: nextPrimary ?? null,
          photo: nextPrimary ?? null,
        });

        setProfile(updatedProfile);
        setProfileCache(updatedProfile);
        if (updatedProfile) {
          broadcastDatingProfileUpdate(updatedProfile);
        }
        await queryClient
          .invalidateQueries({ queryKey: datingProfilesKey })
          .catch(() => {});
        broadcastMessage("tm:dating", { type: "dating:invalidate" });
        openSuccessToast("Photo uploaded.");
      } catch (error) {
        console.error("Failed to upload dating photo", error);
        showToast("Unable to upload photo. Please try again.", 3000, "error");
      } finally {
        setIsUploading(false);
        setPendingSecondaryId(null);
        setPendingSecondaryPreview((previous) => {
          if (previous) {
            URL.revokeObjectURL(previous);
          }
          return null;
        });
        setUploadMode("add");
      }
    },
    [
      authUsername,
      broadcastDatingProfileUpdate,
      canAddMorePhotos,
      openSuccessToast,
      primaryPhoto,
      queryClient,
      secondaryPhotos,
      showToast,
      uploadMode,
      setProfileCache,
    ]
  );

  const displayPhoto = primaryPhoto;

  const displayName = useMemo(() => {
    if (!profile) return targetUsername ?? "";
    const candidates = [
      profile.displayName,
      profile.firstName,
      (profile as any)?.name,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
    return profile.username || targetUsername || "";
  }, [profile, targetUsername]);

  const ageValue = useMemo(() => {
    if (!profile) return "";
    if (typeof profile.age === "number") return String(profile.age);
    if (typeof (profile as any).age === "string") return (profile as any).age;
    return "";
  }, [profile]);

  const genderValue = useMemo(
    () => normalizeGender(profile?.gender),
    [profile?.gender]
  );

  const heightValue = useMemo(() => {
    if (!profile) return "";
    const value =
      typeof profile.height === "string" ? profile.height.trim() : "";
    return value;
  }, [profile]);

  const bodyTypeValue = useMemo(() => {
    if (!profile) return "";
    const direct =
      typeof profile.bodyType === "string" ? profile.bodyType.trim() : "";
    if (direct) return direct;
    const legacy = (profile as any)?.body ?? (profile as any)?.physique;
    return typeof legacy === "string" ? legacy.trim() : "";
  }, [profile]);

  const locationValue = useMemo(() => joinLocation(profile), [profile]);

  const smokingValue = useMemo(
    () => normalizeSmoking(profile?.smoking || (profile as any)?.smoke),
    [profile?.smoking, profile]
  );

  const drinkingValue = useMemo(
    () => normalizeDrinking(profile?.drinking || (profile as any)?.drink),
    [profile?.drinking, profile]
  );

  const religionValue = useMemo(
    () => normalizeReligion(profile?.religion),
    [profile?.religion]
  );

  const childrenValue = useMemo(() => {
    if (!profile) return "";
    const choice = normalizeChildren(profile.children);
    const countFromField =
      typeof profile.childrenCount === "number" && profile.childrenCount > 0
        ? String(profile.childrenCount)
        : extractChildrenCount(profile.children);
    if (!choice) return "";
    if (requiresChildrenCount(choice)) {
      const numeric = Number.parseInt(countFromField, 10);
      if (Number.isFinite(numeric) && numeric > 0) {
        const choiceLower = choice.toLowerCase();
        const livesWithMe =
          !choiceLower.includes("don't") && !choiceLower.includes("dont");
        const quantityLabel = numeric === 1 ? "a child" : `${numeric} children`;
        const verbPhrase = (() => {
          if (numeric === 1) {
            return livesWithMe
              ? "who lives with me"
              : "who doesn't live with me";
          }
          return livesWithMe ? "who live with me" : "who don't live with me";
        })();
        return `I have ${quantityLabel} ${verbPhrase}`;
      }
    }
    return choice;
  }, [profile]);

  const relocationValue = useMemo(
    () => normalizeRelocation(profile?.relocation),
    [profile?.relocation]
  );

  const nationalityValue = useMemo(() => {
    if (!profile) return "";
    const base =
      typeof profile.nationality === "string" ? profile.nationality.trim() : "";
    if (base) return base;
    const country = profile.location?.country;
    return typeof country === "string" ? country.trim() : "";
  }, [profile]);

  const educationValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      education?: string;
      educationLevel?: string;
      school?: string;
    };
    const value =
      possible?.education ?? possible?.educationLevel ?? possible?.school ?? "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const jobTitleValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      jobTitle?: string;
      occupation?: string;
      profession?: string;
      job?: string;
    };
    const value =
      possible?.jobTitle ??
      possible?.occupation ??
      possible?.profession ??
      possible?.job ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const companyValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      company?: string;
      workplace?: string;
      employer?: string;
    };
    const value =
      possible?.company ?? possible?.workplace ?? possible?.employer ?? "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const lifePhilosophyValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      lifePhilosophy?: string;
      philosophy?: string;
      beliefs?: string;
      values?: string;
    };
    const value =
      possible?.lifePhilosophy ??
      possible?.philosophy ??
      possible?.beliefs ??
      possible?.values ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const communicationStyleValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      communicationStyle?: string;
      loveLanguage?: string;
      socialStyle?: string;
    };
    const value =
      possible?.communicationStyle ??
      possible?.loveLanguage ??
      possible?.socialStyle ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const relationshipDisplay = useMemo(() => {
    if (!profile) return "";
    const raw = profile as unknown as {
      relationshipLookingFor?: string[] | string;
      relationshipPreference?: string[] | string;
      relationshipsLookingFor?: string[] | string;
      lookingFor?: string[] | string;
      relationship?: string[] | string;
      relationshipGoal?: string[] | string;
    };
    const collected: string[] = [];
    const add = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(add);
      else if (typeof value === "string") collected.push(value);
    };
    add(raw.relationshipLookingFor);
    add(raw.relationshipPreference);
    add(raw.relationshipsLookingFor);
    add(raw.lookingFor);
    add(raw.relationship);
    add(raw.relationshipGoal);
    const canonical = toCanonicalRelationshipList(collected);
    return canonical.join(", ");
  }, [profile]);

  const profileHeadingValue = useMemo(() => {
    if (!profile) return "";
    const mood = typeof profile.mood === "string" ? profile.mood.trim() : "";
    if (mood) return mood;
    return typeof (profile as any).heading === "string"
      ? (profile as any).heading.trim()
      : "";
  }, [profile]);

  const aboutValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      about?: string;
      aboutMe?: string;
      bio?: string;
      description?: string;
      summary?: string;
    };
    return (
      possible?.about?.trim() ||
      possible?.aboutMe?.trim() ||
      possible?.bio?.trim() ||
      possible?.description?.trim() ||
      possible?.summary?.trim() ||
      ""
    );
  }, [profile]);

  const lookingForValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      partnerLookingFor?: string;
      lookingForInPartner?: string;
      partnerDescription?: string;
    };
    return (
      possible?.partnerLookingFor?.trim() ||
      possible?.lookingForInPartner?.trim() ||
      possible?.partnerDescription?.trim() ||
      ""
    );
  }, [profile]);

  const hobbyValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      hobby?: string;
      hobbies?: string;
      favoriteHobby?: string;
    };
    const value =
      possible?.hobby ?? possible?.hobbies ?? possible?.favoriteHobby ?? "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const weekendActivityValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      weekendActivity?: string;
      weekendActivities?: string;
      typicalWeekend?: string;
    };
    const value =
      possible?.weekendActivity ??
      possible?.weekendActivities ??
      possible?.typicalWeekend ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const travelDestinationValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      travelDestination?: string;
      dreamDestination?: string;
      favoriteDestination?: string;
    };
    const value =
      possible?.travelDestination ??
      possible?.dreamDestination ??
      possible?.favoriteDestination ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const fitnessActivityValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      fitnessActivity?: string;
      workout?: string;
      exercise?: string;
    };
    const value =
      possible?.fitnessActivity ??
      possible?.workout ??
      possible?.exercise ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const favoriteMovieValue = useMemo(() => {
    if (!profile) return "";
    return typeof profile.favoriteMovie === "string"
      ? profile.favoriteMovie.trim()
      : "";
  }, [profile]);

  const musicPreferenceValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      favoriteMusic?: string;
      musicPreference?: string;
      musicPreferences?: string;
    };
    return (
      possible?.favoriteMusic?.trim() ||
      possible?.musicPreference?.trim() ||
      possible?.musicPreferences?.trim() ||
      ""
    );
  }, [profile]);

  const foodPreferenceValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      favoriteFood?: string;
      foodPreference?: string;
      foodPreferences?: string;
    };
    return (
      possible?.favoriteFood?.trim() ||
      possible?.foodPreference?.trim() ||
      possible?.foodPreferences?.trim() ||
      ""
    );
  }, [profile]);

  const perfectMatchValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      perfectMatchDescription?: string;
      perfectMatch?: string;
      idealPartner?: string;
    };
    return (
      possible?.perfectMatchDescription?.trim() ||
      possible?.perfectMatch?.trim() ||
      possible?.idealPartner?.trim() ||
      ""
    );
  }, [profile]);

  const datingProConValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      datingProCon?: string;
      prosAndCons?: string;
      prosConsOfDatingMe?: string;
    };
    const value =
      possible?.datingProCon ??
      possible?.prosAndCons ??
      possible?.prosConsOfDatingMe ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const loveLanguageValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      loveLanguage?: string;
      myLoveLanguage?: string;
      loveLanguages?: string;
    };
    const value =
      possible?.loveLanguage ??
      possible?.myLoveLanguage ??
      possible?.loveLanguages ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const firstDateValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      firstDate?: string;
      idealFirstDate?: string;
      perfectFirstDate?: string;
    };
    const value =
      possible?.firstDate ??
      possible?.idealFirstDate ??
      possible?.perfectFirstDate ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const greenFlagValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      greenFlag?: string;
      greenFlags?: string;
      myGreenFlag?: string;
    };
    const value =
      possible?.greenFlag ??
      possible?.greenFlags ??
      possible?.myGreenFlag ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const redFlagValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      redFlag?: string;
      redFlags?: string;
      dealBreaker?: string;
    };
    const value =
      possible?.redFlag ?? possible?.redFlags ?? possible?.dealBreaker ?? "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const seekingForValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      seekingFor?: string;
      seeking?: string;
      lookingForRelationship?: string;
    };
    const value =
      possible?.seekingFor ??
      possible?.seeking ??
      possible?.lookingForRelationship ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const selfCareValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      selfCare?: string;
      selfCareIs?: string;
      mySelfCare?: string;
    };
    const value =
      possible?.selfCare ?? possible?.selfCareIs ?? possible?.mySelfCare ?? "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const simplePleasuresValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      simplePleasures?: string;
      mySimplePleasures?: string;
      simplePleasure?: string;
    };
    const value =
      possible?.simplePleasures ??
      possible?.mySimplePleasures ??
      possible?.simplePleasure ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

  const greatRelationshipValue = useMemo(() => {
    if (!profile) return "";
    const possible = profile as unknown as {
      greatRelationship?: string;
      relationshipGreat?: string;
      whatMakesRelationshipGreat?: string;
    };
    const value =
      possible?.greatRelationship ??
      possible?.relationshipGreat ??
      possible?.whatMakesRelationshipGreat ??
      "";
    return typeof value === "string" ? value.trim() : "";
  }, [profile]);

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

  const visibleAnswerQuestions = useMemo(
    () => answerQuestions.filter((item) => hasAnswerValue(item.value)),
    [answerQuestions]
  );

  const conversationItems: SectionItem[] = useMemo(
    () =>
      visibleAnswerQuestions.map((item) => ({
        label: item.label,
        value: item.value,
      })),
    [visibleAnswerQuestions]
  );

  const basics: SectionItem[] = useMemo(
    () => [
      {
        label: "Name",
        value: displayName,
        icon: <User size={24} aria-label="Name" className="text-gray-900" />,
      },
      {
        label: "Age",
        value: ageValue,
        icon: <Cake size={24} aria-label="Age" className="text-gray-900" />,
      },
      {
        label: "Location",
        value: locationValue,
        icon: (
          <MapPin size={24} aria-label="Location" className="text-gray-900" />
        ),
      },
      {
        label: "Gender",
        value: genderValue,
        icon: (
          <GenderIntersex
            size={24}
            aria-label="Gender"
            className="text-gray-900"
          />
        ),
      },
      {
        label: "Height",
        value: heightValue,
        icon: <Ruler size={24} aria-label="Height" className="text-gray-900" />,
      },
      {
        label: "Body type",
        value: bodyTypeValue,
        icon: (
          <PersonSimple
            size={24}
            aria-label="Body type"
            className="text-gray-900"
          />
        ),
      },
    ],
    [
      displayName,
      ageValue,
      locationValue,
      genderValue,
      heightValue,
      bodyTypeValue,
    ]
  );

  const showSectionEditButton = viewingOwnProfile;

  const handleSectionEdit = useCallback(
    (sectionKey: SectionEditKey) => {
      if (!showSectionEditButton) {
        return;
      }
      const focusSection = SECTION_EDIT_TARGETS[sectionKey];
      if (!focusSection) {
        return;
      }
      const editUserId =
        profileUserIdValue ?? targetUserId ?? authUserIdValue ?? null;
      if (!editUserId) {
        showToast("Unable to open the editor right now.", 2600, "error");
        return;
      }
      const params = new URLSearchParams();
      params.set("section", focusSection);
      navigate(
        `/edit-dating-profile/profile/${encodeURIComponent(
          editUserId
        )}?${params.toString()}`,
        { state: { focusSection, focusTimestamp: Date.now() } }
      );
    },
    [
      authUserIdValue,
      navigate,
      profileUserIdValue,
      showSectionEditButton,
      showToast,
      targetUserId,
    ]
  );

  const lifestyle: SectionItem[] = useMemo(
    () => [
      { label: "Smoking", value: smokingValue },
      { label: "Drinking", value: drinkingValue },
      { label: "Kids", value: childrenValue },
      { label: "Open to relocating", value: relocationValue },
      {
        label: "Looking for",
        value: relationshipDisplay,
        variant: "pill-list",
      },
    ],
    [
      smokingValue,
      drinkingValue,
      childrenValue,
      relocationValue,
      relationshipDisplay,
    ]
  );

  const background: SectionItem[] = useMemo(
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

  const personality: SectionItem[] = useMemo(
    () => [
      { label: "Introduce yourself", value: aboutValue },
      {
        label: "I'm looking for",
        value: lookingForValue,
      },
      {
        label: "My go-to hobby",
        value: hobbyValue,
      },
      {
        label: "Perfect weekend activity",
        value: weekendActivityValue,
      },
      {
        label: "Dream travel destination",
        value: travelDestinationValue,
      },
      {
        label: "How I stay active",
        value: fitnessActivityValue,
      },
      {
        label: "My favorite movie",
        value: favoriteMovieValue,
      },
      {
        label: "Music I vibe with",
        value: musicPreferenceValue,
      },
      {
        label: "Food I can't resist",
        value: foodPreferenceValue,
      },
      {
        label: "My ideal match",
        value: perfectMatchValue,
      },
    ],
    [
      aboutValue,
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

  const bioItems: SectionItem[] = useMemo(
    () => [
      {
        label: "Bio",
        value: profileHeadingValue,
        variant: "paragraph",
      },
    ],
    [profileHeadingValue]
  );

  const hasBioAnswer = useMemo(
    () => bioItems.some((item) => hasAnswerValue(item.value)),
    [bioItems]
  );

  const hasBasicsAnswers = useMemo(
    () => basics.some((item) => hasAnswerValue(item.value)),
    [basics]
  );

  const hasLifestyleAnswers = useMemo(
    () => lifestyle.some((item) => hasAnswerValue(item.value)),
    [lifestyle]
  );

  const hasBackgroundAnswers = useMemo(
    () => background.some((item) => hasAnswerValue(item.value)),
    [background]
  );

  const hasInterestsAnswers = useMemo(
    () => personality.some((item) => hasAnswerValue(item.value)),
    [personality]
  );

  const hasConversationAnswers = useMemo(
    () => conversationItems.length > 0,
    [conversationItems]
  );

  const sectionDefinitions = useMemo<PhotoDragDropSection[]>(() => {
    const definitions: PhotoDragDropSection[] = [];

    if (showSectionEditButton || hasBioAnswer) {
      definitions.push({
        id: "my-bio",
        label: "About me",
        content: (
          <SectionBlock
            title="About me"
            items={bioItems}
            showEditButton={showSectionEditButton}
            onEdit={
              showSectionEditButton ? () => handleSectionEdit("bio") : undefined
            }
            editLabel="Edit About me section"
            emptyHint={SECTION_EMPTY_HINTS.bio}
            hideIfEmpty={!showSectionEditButton}
          />
        ),
        photosEnabled: hasBioAnswer,
      });
    }

    if (showSectionEditButton || hasBasicsAnswers) {
      definitions.push({
        id: "basics",
        label: "Basics",
        content: (
          <SectionBlock
            title="Basics"
            items={basics}
            showEditButton={showSectionEditButton}
            onEdit={
              showSectionEditButton
                ? () => handleSectionEdit("basics")
                : undefined
            }
            editLabel="Edit Basics section"
            emptyHint={SECTION_EMPTY_HINTS.basics}
            hideIfEmpty={!showSectionEditButton}
          />
        ),
        photosEnabled: hasBasicsAnswers,
      });
    }

    if (showSectionEditButton || hasLifestyleAnswers) {
      definitions.push({
        id: "lifestyle",
        label: "Lifestyle",
        content: (
          <SectionBlock
            title="Lifestyle"
            items={lifestyle}
            showEditButton={showSectionEditButton}
            onEdit={
              showSectionEditButton
                ? () => handleSectionEdit("lifestyle")
                : undefined
            }
            editLabel="Edit Lifestyle section"
            emptyHint={SECTION_EMPTY_HINTS.lifestyle}
            hideIfEmpty={!showSectionEditButton}
          />
        ),
        photosEnabled: hasLifestyleAnswers,
      });
    }

    if (showSectionEditButton || hasBackgroundAnswers) {
      definitions.push({
        id: "background",
        label: "Background",
        content: (
          <SectionBlock
            title="Background"
            items={background}
            showEditButton={showSectionEditButton}
            onEdit={
              showSectionEditButton
                ? () => handleSectionEdit("background")
                : undefined
            }
            editLabel="Edit Background section"
            emptyHint={SECTION_EMPTY_HINTS.background}
            hideIfEmpty={!showSectionEditButton}
          />
        ),
        photosEnabled: hasBackgroundAnswers,
      });
    }

    if (showSectionEditButton || hasInterestsAnswers) {
      definitions.push({
        id: "interests",
        label: "My interests & hobbies",
        content: (
          <SectionBlock
            title="My interests & hobbies"
            items={personality}
            showEditButton={showSectionEditButton}
            onEdit={
              showSectionEditButton
                ? () => handleSectionEdit("interests")
                : undefined
            }
            editLabel="Edit interests section"
            emptyHint={SECTION_EMPTY_HINTS.interests}
            hideIfEmpty={!showSectionEditButton}
          />
        ),
        photosEnabled: hasInterestsAnswers,
      });
    }

    if (showSectionEditButton || hasConversationAnswers) {
      definitions.push({
        id: "conversation",
        label: "Others",
        content: (
          <SectionBlock
            title="Others"
            items={conversationItems}
            showEditButton={showSectionEditButton}
            onEdit={
              showSectionEditButton
                ? () => handleSectionEdit("conversation")
                : undefined
            }
            editLabel="Edit Answer Questions section"
            emptyHint={SECTION_EMPTY_HINTS.conversation}
            hideIfEmpty={!showSectionEditButton}
          />
        ),
        photosEnabled: hasConversationAnswers,
      });
    }

    return definitions;
  }, [
    background,
    bioItems,
    basics,
    conversationItems,
    answerQuestions,
    hasBackgroundAnswers,
    hasBasicsAnswers,
    hasBioAnswer,
    hasConversationAnswers,
    hasInterestsAnswers,
    hasLifestyleAnswers,
    handleSectionEdit,
    lifestyle,
    personality,
    showSectionEditButton,
  ]);

  const sectionIdSet = useMemo(
    () => new Set(sectionDefinitions.map((section) => section.id)),
    [sectionDefinitions]
  );

  const normalizedPhotoPlacements = useMemo(
    () =>
      normalizePhotoPlacementsForDisplay(
        profile?.photoPlacements ?? null,
        photoIdSet,
        sectionIdSet
      ),
    [profile?.photoPlacements, photoIdSet, sectionIdSet]
  );

  const renderAvailableArea = useCallback<
    NonNullable<PhotoDragDropProps["renderAvailable"]>
  >(
    ({ photos: availablePhotos, renderDropZone, isInteractive }) => {
      if (!isInteractive) {
        if (!availablePhotos.length) {
          return null;
        }
        return renderDropZone({
          className: "border-none bg-transparent p-0",
          renderPhotos: ({ photos, DraggablePhoto, isViewerMode }) => (
            <div className="space-y-4">
              {photos.map((photo) => (
                <DraggablePhoto
                  key={photo.id}
                  photo={photo}
                  isViewerMode={isViewerMode}
                />
              ))}
            </div>
          ),
        });
      }

      const showAvailableDropZone =
        availablePhotos.length > 0 || Boolean(pendingSecondaryId);

      return (
        <div className="space-y-4">
          <div
            className={`grid gap-4${
              showAvailableDropZone ? " sm:grid-cols-2" : ""
            }`}
          >
            <button
              type="button"
              onClick={handleAddPhotoClick}
              disabled={isUploading || !canAddMorePhotos}
              className="flex min-h-[200px] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-gray-500 transition hover:border-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
              aria-label={addPhotoButtonAriaLabel}
            >
              {isSecondaryUploadInProgress ? (
                <LoadingSpinner size={32} label="Uploading photo" />
              ) : (
                <Plus
                  size={32}
                  weight="bold"
                  aria-hidden="true"
                  className={canAddMorePhotos ? undefined : "text-gray-300"}
                />
              )}
              {!isSecondaryUploadInProgress && (
                <span className="text-sm font-medium">
                  {addPhotoButtonText}
                </span>
              )}
            </button>
            {showAvailableDropZone
              ? renderDropZone({
                  className: "border-none bg-transparent p-0",
                  renderPhotos: ({ photos, DraggablePhoto, isViewerMode }) => (
                    <div className="space-y-4">
                      {photos.map((photo) => (
                        <DraggablePhoto
                          key={photo.id}
                          photo={photo}
                          isViewerMode={isViewerMode}
                        />
                      ))}
                      {pendingSecondaryId ? (
                        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-gray-100 ring-1 ring-black/5">
                          {pendingSecondaryPreview ? (
                            <img
                              src={pendingSecondaryPreview}
                              alt="Uploading photo preview"
                              className="h-full w-full select-none object-cover"
                              draggable={false}
                            />
                          ) : (
                            <div
                              className="h-full w-full bg-gray-200"
                              aria-hidden="true"
                            />
                          )}
                          <div
                            className="absolute inset-0 bg-black/40"
                            aria-hidden="true"
                          />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <LoadingSpinner size={28} label="Uploading photo" />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ),
                })
              : null}
          </div>
        </div>
      );
    },
    [
      addPhotoButtonAriaLabel,
      addPhotoButtonText,
      canAddMorePhotos,
      handleAddPhotoClick,
      isSecondaryUploadInProgress,
      pendingSecondaryId,
      pendingSecondaryPreview,
      isUploading,
    ]
  );

  const handlePhotoDelete = useCallback(
    async (photo: PhotoDragDropPhoto) => {
      if (!canManagePhotos || !authUsername) {
        return;
      }

      const photoUrl = photo.src;
      if (!photoUrl) {
        return;
      }

      setDeletingPhotoIds((current) => {
        const next = new Set(current);
        next.add(photoUrl);
        return next;
      });

      try {
        const updatedProfile = await removeDatingPhoto(
          String(authUsername),
          photoUrl
        );

        setProfile(updatedProfile);
        setProfileCache(updatedProfile);
        if (updatedProfile) {
          broadcastDatingProfileUpdate(updatedProfile);
        }
        await queryClient
          .invalidateQueries({ queryKey: datingProfilesKey })
          .catch(() => {});
        broadcastMessage("tm:dating", { type: "dating:invalidate" });
        openSuccessToast("Photo deleted.");
      } catch (error) {
        console.error("Failed to delete dating photo", error);
        showToast("Unable to delete photo. Please try again.", 3200, "error");
      } finally {
        setDeletingPhotoIds((current) => {
          const next = new Set(current);
          next.delete(photoUrl);
          return next;
        });
      }
    },
    [
      authUsername,
      broadcastDatingProfileUpdate,
      canManagePhotos,
      openSuccessToast,
      queryClient,
      setProfileCache,
      showToast,
    ]
  );

  const handlePhotoDrop = useCallback<PhotoDragDropProps["onDrop"]>(
    async ({ sectionId, sectionLabel, assignments }) => {
      const message =
        sectionId === PHOTO_DRAG_DROP_AVAILABLE_ID
          ? "Photo returned to your photo tray."
          : `Photo moved to ${sectionLabel || "this section"}.`;
      openSuccessToast(message);

      if (!canManagePhotos || !authUsername) {
        return;
      }

      const placementsToPersist: PhotoDragDropAssignments = {};
      for (const [photoId, placementSectionId] of Object.entries(assignments)) {
        if (!photoIdSet.has(photoId)) {
          continue;
        }
        if (placementSectionId === PHOTO_DRAG_DROP_AVAILABLE_ID) {
          continue;
        }
        if (!sectionIdSet.has(placementSectionId)) {
          continue;
        }
        placementsToPersist[photoId] = placementSectionId;
      }

      if (placementMapsEqual(placementsToPersist, normalizedPhotoPlacements)) {
        return;
      }

      const previousPlacements = normalizedPhotoPlacements;

      try {
        const updatedProfile = await saveDatingProfile({
          username: String(authUsername),
          photoPlacements: placementsToPersist,
        });
        setProfile(updatedProfile);
        setProfileCache(updatedProfile);
        if (updatedProfile) {
          broadcastDatingProfileUpdate(updatedProfile);
        }
        await queryClient
          .invalidateQueries({ queryKey: datingProfilesKey })
          .catch(() => {});
        broadcastMessage("tm:dating", { type: "dating:invalidate" });
      } catch (error) {
        console.error("Failed to save photo placements", error);
        showToast(
          "Unable to save photo layout. Please try again.",
          3200,
          "error"
        );
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                photoPlacements: { ...previousPlacements },
              }
            : prev
        );
      }
    },
    [
      authUsername,
      broadcastDatingProfileUpdate,
      canManagePhotos,
      normalizedPhotoPlacements,
      openSuccessToast,
      photoIdSet,
      queryClient,
      sectionIdSet,
      setProfileCache,
      showToast,
    ]
  );

  const hideTitleFromState = routeState.hideTitle;
  const shouldHideTitle = useMemo(() => {
    if (!viewingOwnProfile) {
      return false;
    }
    if (typeof hideTitle === "boolean") return hideTitle;
    if (typeof hideTitleFromState === "boolean") return hideTitleFromState;
    return false;
  }, [hideTitle, hideTitleFromState, viewingOwnProfile]);

  const pageHeaderTitle = useMemo(() => {
    if (shouldHideTitle) return "";
    if (!viewingOwnProfile && displayName) return displayName;
    return "Dating profile";
  }, [displayName, shouldHideTitle, viewingOwnProfile]);

  if (!targetUserId && !targetUsername) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="max-w-md text-center">
          <p className="text-base text-gray-600">
            Sign in to view your dating profile.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-600"
          >
            Go to login
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <LoadingSpinner size={40} label="Loading dating profile" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="max-w-sm text-center">
          <p className="text-base text-gray-700">
            We could not load your dating profile right now.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-600"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-base text-gray-700">
            You have not created a dating profile yet.
          </p>
          <button
            type="button"
            onClick={() => navigate("/dating-profile/create")}
            className="inline-flex items-center justify-center rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-600"
          >
            Create dating profile
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PageHeader
        title={pageHeaderTitle}
        onBack={() => navigate(-1)}
        containerClassName="max-w-3xl mx-auto"
      />
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8 pb-12 pt-4">
        <section>
          <div className="relative overflow-hidden rounded-2xl">
            {displayPhoto ? (
              <img
                src={displayPhoto}
                alt={`${displayName} dating profile`}
                className="w-full aspect-[4/5] object-cover"
              />
            ) : (
              <div className="flex aspect-[4/5] w-full items-center justify-center bg-gray-100 text-sm text-gray-500">
                No photo provided
              </div>
            )}
            {(displayName || ageValue) && displayPhoto ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-start px-5 pb-5 text-white drop-shadow-lg">
                <p className="text-2xl font-semibold leading-tight sm:text-3xl">
                  {displayName}
                  {ageValue ? `, ${ageValue}` : ""}
                </p>
              </div>
            ) : null}
            {canManagePhotos ? (
              <button
                type="button"
                onClick={handleChangePrimaryPhotoClick}
                disabled={isUploading}
                className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/80 text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={
                  displayPhoto ? "Change primary photo" : "Upload primary photo"
                }
              >
                <PencilSimple size={22} weight="bold" aria-hidden="true" />
              </button>
            ) : null}
            {isPrimaryUpload ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <LoadingSpinner
                  size={36}
                  label="Uploading primary photo"
                  className="text-white"
                />
              </div>
            ) : null}
          </div>
        </section>

        <div className="mt-4 space-y-4">
          {canManagePhotos ? (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileInputChange}
            />
          ) : null}
          <PhotoDragDrop
            photos={dragDropPhotos}
            sections={sectionDefinitions}
            initialAssignments={normalizedPhotoPlacements}
            onDrop={handlePhotoDrop}
            isInteractive={canManagePhotos}
            renderAvailable={renderAvailableArea}
            className={canManagePhotos ? "space-y-6" : undefined}
            onDeletePhoto={canManagePhotos ? handlePhotoDelete : undefined}
            deletingPhotoIds={canManagePhotos ? deletingPhotoIds : undefined}
          />
        </div>
      </div>
      <SuccessToast
        key={successToastState.id}
        open={isSuccessToastOpen && Boolean(successToastState.message)}
        message={successToastState.message}
        duration={successToastState.duration}
        onClose={closeSuccessToast}
      />
    </div>
  );
};

export default DatingProfilePage;
