import React, { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  UploadSimple,
  X,
  CaretLeft,
  CaretRight,
  Trash,
  WarningCircle,
} from "phosphor-react";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { useDatingStore } from "../stores/datingStore";
import { useLikesStore } from "../stores/likesStore";
import BottomSheet from "../components/common/BottomSheet";
import {
  saveDatingProfile,
  uploadDatingPhoto,
  fetchDatingProfile,
  deleteDatingProfile,
  removeDatingPhoto,
} from "../services/api";
import type { DatingProfile, GeoLocation } from "../types";

// Constants used for selection lists
const RELIGION_OPTIONS = [
  "Any",
  "Christian",
  "Muslim",
  "Hindu",
  "Buddhist",
  "Jewish",
  "Atheist",
  "Other",
];

const HEADLINE_OPTIONS = [
  "Looking for a relationship",
  "Open to a casual connection",
  "Seeking friendship",
  "Bored—looking to chat",
  "Looking for a serious relationship",
  "Just exploring",
];

const PREF_RELIGIONS = RELIGION_OPTIONS;

const EditDatingProfile: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { username } = useAuthStore();
  const { showToast } = useUiStore();
  const { profile, setPhoto } = useDatingStore();

  const [photos, setPhotos] = useState<string[]>(() => {
    const prim = (profile?.photo as string) || null;
    return prim ? [prim] : [];
  });
  const [reorderMode, setReorderMode] = useState(false);
  const primary = photos[0] || null;
  const [uploadingSet, setUploadingSet] = useState<Set<string>>(new Set());

  // Sync global store primary after render commits to avoid setState-in-render warnings
  useEffect(() => {
    setPhoto(primary);
  }, [primary, setPhoto]);

  const movePhoto = (fromIdx: number, toIdx: number) => {
    setPhotos((prev) => {
      const arr = [...prev];
      if (
        fromIdx < 0 ||
        toIdx < 0 ||
        fromIdx >= arr.length ||
        toIdx >= arr.length ||
        fromIdx === toIdx
      )
        return prev;
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      // Mark form dirty via primary change
      setValue("photo", arr[0] || null, { shouldDirty: true });
      // Mark photos array as changed (enables Save after reorder)
      setValue("photos", arr as any, { shouldDirty: true });
      return arr;
    });
  };

  // Zod form schema
  const FormSchema = z
    .object({
      photo: z.string().nullable().optional(),
      photos: z.array(z.string()).optional(),
      mood: z.string().optional().nullable(),
      age: z
        .union([z.number().min(18).max(99), z.nan().transform(() => undefined)])
        .optional(),
      religion: z.string().optional(),
      location: z
        .object({ city: z.string().optional(), state: z.string().optional() })
        .optional(),
      preferences: z.object({
        age: z.object({
          min: z.number().min(18).max(99),
          max: z.number().min(18).max(99),
        }),
        religions: z.array(z.string()).optional(),
      }),
    })
    .refine(
      (d: any) =>
        !d.preferences || d.preferences.age.min <= d.preferences.age.max,
      {
        path: ["preferences", "age", "max"],
        message: "Max age must be ≥ Min age",
      }
    );

  type FormValues = z.infer<typeof FormSchema>;

  const {
    register,
    setValue,
    getValues,
    reset,
    watch,
    formState: { isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      photo:
        (profile?.photo as any) ?? ((profile as any)?.photoUrl as any) ?? null,
      photos: photos as any,
      mood: profile?.mood ?? "",
      age:
        typeof (profile as any)?.age === "number"
          ? (profile as any).age
          : undefined,
      religion: (profile as any)?.religion ?? "",
      location: {
        city: ((profile as any)?.location?.city as string) || "",
        state: ((profile as any)?.location?.state as string) || "",
      },
      preferences: {
        age: {
          min: ((profile as any)?.preferences?.age?.min as number) ?? 21,
          max: ((profile as any)?.preferences?.age?.max as number) ?? 28,
        },
        religions: ((
          ((profile as any)?.preferences?.religions as string[] | undefined) ||
          []
        ).length
          ? ((profile as any)?.preferences?.religions as string[])
          : ["Any"]) as string[],
      },
    },
  });

  // Server profile via React Query
  const { data: serverProfile, isLoading } = useQuery({
    queryKey: ["datingProfile", username],
    queryFn: () => fetchDatingProfile(username || ""),
    enabled: Boolean(username),
  });

  // Reset form when server profile arrives (first load), or clear when null
  useEffect(() => {
    if (serverProfile === undefined) return; // still loading
    if (serverProfile === null) {
      // No existing profile -> clear form and preview
      reset({
        photo: null as any,
        photos: [] as any,
        mood: "",
        age: undefined,
        religion: "",
        location: { city: "", state: "" },
        preferences: { age: { min: 21, max: 28 }, religions: ["Any"] },
      } as any);
      setPhotos([]);
      return;
    }
    reset({
      photo:
        ((serverProfile as any).photo as any) ??
        ((serverProfile as any).photoUrl as any) ??
        null,
      photos: (Array.isArray((serverProfile as any)?.photos)
        ? ((serverProfile as any).photos as string[])
        : []) as any,
      mood: (serverProfile as any).mood ?? "",
      age:
        typeof (serverProfile as any).age === "number"
          ? (serverProfile as any).age
          : undefined,
      religion: (serverProfile as any).religion ?? "",
      location: {
        city: ((serverProfile as any)?.location?.city as string) || "",
        state: ((serverProfile as any)?.location?.state as string) || "",
      },
      preferences: {
        age: {
          min: ((serverProfile as any)?.preferences?.age?.min as number) ?? 21,
          max: ((serverProfile as any)?.preferences?.age?.max as number) ?? 28,
        },
        religions: ((
          ((serverProfile as any)?.preferences?.religions as
            | string[]
            | undefined) || []
        ).length
          ? ((serverProfile as any)?.preferences?.religions as string[])
          : ["Any"]) as string[],
      },
    });
    {
      const arr: string[] = Array.isArray((serverProfile as any)?.photos)
        ? ((serverProfile as any).photos as string[])
        : [];
      const prim =
        ((serverProfile as any).photo as string) ||
        ((serverProfile as any).photoUrl as string) ||
        null;
      const merged = [...arr, ...(prim ? [prim] : [])];
      setPhotos(Array.from(new Set(merged.filter(Boolean))));
    }
  }, [serverProfile, reset]);

  // Warn before unload if there are unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Mutation for save
  const mutation = useMutation({
    mutationFn: saveDatingProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["datingProfile", username] });
      reset(getValues());
      showToast("Dating profile saved");
      navigate(-1);
    },
    onError: () => showToast("Failed to save profile"),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const onPickPhoto = () => fileInputRef.current?.click();

  const handlePhotoChange: React.ChangeEventHandler<HTMLInputElement> = async (
    e
  ) => {
    const file = (e.target.files && e.target.files[0]) || null;
    if (!file) return;
    try {
      // Create optimistic preview
      const previewUrl = URL.createObjectURL(file);
      setUploadingSet((prev) => new Set(prev).add(previewUrl));
      setPhotos((prev) => {
        const next = [...(prev || []), previewUrl];
        setValue("photos", next as any, { shouldDirty: true });
        return next;
      });

      // Upload and replace preview with final URL
      const { url } = await uploadDatingPhoto(file, username || "");
      setPhotos((prev) => {
        const replaced = (prev || []).map((u) => (u === previewUrl ? url : u));
        setValue("photos", replaced as any, { shouldDirty: true });
        // Update primary from replaced (form state only; global store sync via effect)
        const nextPrimary = replaced[0] || null;
        setValue("photo", nextPrimary as any, { shouldDirty: true });
        return replaced;
      });
      URL.revokeObjectURL(previewUrl);
      setUploadingSet((prev) => {
        const next = new Set(prev);
        next.delete(previewUrl);
        return next;
      });
    } catch (err) {
      console.error(err);
      // Remove optimistic preview if we showed one
      try {
        const files = e.target.files;
        if (files && files[0]) {
          const candidate = URL.createObjectURL(files[0]);
          URL.revokeObjectURL(candidate);
        }
      } catch {}
      showToast("Failed to upload photo");
    }
  };

  // Headline selection via BottomSheet
  const [showHeadlineSheet, setShowHeadlineSheet] = useState(false);

  const handleSave = async () => {
    try {
      const values = getValues();
      const city = values.location?.city || "";
      const stateName = values.location?.state || "";
      const location: GeoLocation | null =
        city || stateName
          ? {
              lat: 0,
              lon: 0,
              city: city || undefined,
              state: stateName || undefined,
              formatted:
                [city, stateName].filter(Boolean).join(", ") || undefined,
            }
          : null;
      const religions = values.preferences?.religions || [];
      const payload: DatingProfile = {
        username: username || "",
        photoUrl: photos[0] || null,
        mood: values.mood || undefined,
        age: values.age ?? undefined,
        religion: values.religion || undefined,
        preferences: {
          age: {
            min: Math.min(
              values.preferences!.age.min,
              values.preferences!.age.max
            ),
            max: Math.max(
              values.preferences!.age.min,
              values.preferences!.age.max
            ),
          },
          religions:
            religions.length && !religions.includes("Any")
              ? religions
              : undefined,
        },
        location,
        updatedAt: Date.now(),
        photos: photos,
      };
      await mutation.mutateAsync(payload);
    } catch (err) {
      console.error(err);
      showToast("Failed to save profile");
    }
  };

  const prefReligions = watch("preferences.religions") || ["Any"];
  const togglePrefReligion = (r: string) => {
    const prev = new Set(prefReligions);
    if (r === "Any") {
      setValue("preferences.religions", ["Any"], { shouldDirty: true });
      return;
    }
    prev.delete("Any");
    if (prev.has(r)) prev.delete(r);
    else prev.add(r);
    const next = Array.from(prev);
    setValue("preferences.religions", next.length ? next : ["Any"], {
      shouldDirty: true,
    });
  };

  const [showDiscardSheet, setShowDiscardSheet] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const handleBack = () => {
    if (!isDirty) {
      navigate(-1);
    } else {
      setShowDiscardSheet(true);
    }
  };

  const { reset: resetDatingStore } = useDatingStore();

  const onConfirmDelete = async () => {
    if (!username) return;
    try {
      setIsDeleting(true);
      await deleteDatingProfile(username);
      // Clear local persisted dating state and react-query cache
      resetDatingStore();
      queryClient.removeQueries({ queryKey: ["datingProfile", username] });
      // Clear likes store so Inbox tabs sync with server immediately
      try {
        useLikesStore.getState().clearAll();
      } catch {}
      // Set a one-time banner flag for the list page
      try {
        sessionStorage.setItem("datingProfileDeleted", "1");
      } catch {}
      showToast("Dating profile deleted");
      setShowDeleteSheet(false);
      navigate(-1);
    } catch (e) {
      console.error(e);
      showToast("Failed to delete profile");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 bg-gray-50 z-10 px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={handleBack}
            className="rounded-full text-gray-900"
            aria-label="Back"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="text-base font-semibold text-gray-900 truncate">
            Edit dating profile
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || mutation.isPending}
          aria-disabled={!isDirty || mutation.isPending}
          className="px-3 py-1.5 text-sm rounded-md bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
      {/* Danger zone moved below main form */}

      <div className="px-4 pb-24">
        {/* Skeleton while loading */}
        {isLoading && (
          <div className="animate-pulse space-y-4">
            <div className="flex flex-col items-center pt-2 pb-4">
              <div className="w-32 h-32 rounded-full bg-gray-200" />
              <div className="h-4 w-24 bg-gray-200 rounded mt-3" />
            </div>
            <div className="bg-white rounded-2xl border p-4 space-y-4">
              <div className="h-3 w-24 bg-gray-200 rounded" />
              <div className="h-10 bg-gray-100 rounded" />
              <div className="h-3 w-24 bg-gray-200 rounded" />
              <div className="h-10 bg-gray-100 rounded" />
            </div>
          </div>
        )}
        {/* Photos manager */}
        {!isLoading && (
          <div className="pt-2 pb-4">
            <div className="flex flex-col items-center">
              <div className="w-32 h-32 rounded-full bg-gray-200 border-4 border-white shadow-sm overflow-hidden">
                {primary ? (
                  <img
                    src={primary}
                    alt="Primary photo"
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                ) : null}
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-gray-800">
                  Your photos
                </div>
                {photos.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setReorderMode((v) => !v)}
                    className="text-xs px-2 py-1 rounded-md bg-black text-white"
                    aria-pressed={reorderMode}
                  >
                    {reorderMode ? "Done" : "Reorder"}
                  </button>
                )}
              </div>
              {photos.length > 0 ? (
                <div className="grid grid-cols-3 gap-3">
                  {photos.map((p, i) => (
                    <div
                      key={`${p}-${i}`}
                      className="relative group"
                      draggable={reorderMode}
                      onDragStart={(e) => {
                        if (!reorderMode) return;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(i));
                      }}
                      onDragOver={(e) => {
                        if (!reorderMode) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        if (!reorderMode) return;
                        e.preventDefault();
                        const from = Number(
                          e.dataTransfer.getData("text/plain")
                        );
                        const to = i;
                        if (!Number.isNaN(from)) movePhoto(from, to);
                      }}
                    >
                      <img
                        src={p}
                        alt={`Photo ${i + 1}`}
                        className="w-full aspect-square object-cover rounded-lg border"
                        draggable={false}
                      />
                      {uploadingSet.has(p) && (
                        <div className="absolute inset-0 rounded-lg bg-black/40 text-white text-[11px] flex items-center justify-center">
                          Uploading...
                        </div>
                      )}
                      {/* Delete */}
                      <button
                        type="button"
                        onClick={async () => {
                          const url = photos[i];
                          // Update local UI first — single-photo removal only
                          const localNext = photos.filter(
                            (_, idx) => idx !== i
                          );
                          setPhotos(localNext);
                          const nextPrimary = localNext[0] || null;
                          setValue("photos", localNext as any, {
                            shouldDirty: true,
                          });
                          setValue("photo", nextPrimary, { shouldDirty: true });
                          // Best-effort server delete; do not overwrite local array with server response
                          try {
                            if (username) {
                              await removeDatingPhoto(username, url);
                              queryClient.invalidateQueries({
                                queryKey: ["datingProfile", username],
                              });
                            }
                          } catch (e) {
                            // Ignore; user can re-save to reconcile if needed
                          }
                        }}
                        aria-label="Remove photo"
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition disabled:opacity-50"
                        disabled={uploadingSet.has(p)}
                      >
                        <X size={14} weight="bold" />
                      </button>
                      {/* Reorder arrows */}
                      {reorderMode && (
                        <div className="absolute inset-x-1 bottom-1 flex justify-between">
                          <button
                            type="button"
                            className="p-1 rounded-full bg-black/60 text-white"
                            onClick={() => movePhoto(i, Math.max(0, i - 1))}
                            aria-label="Move left"
                          >
                            <CaretLeft size={14} weight="bold" />
                          </button>
                          <button
                            type="button"
                            className="p-1 rounded-full bg-black/60 text-white"
                            onClick={() =>
                              movePhoto(i, Math.min(photos.length - 1, i + 1))
                            }
                            aria-label="Move right"
                          >
                            <CaretRight size={14} weight="bold" />
                          </button>
                        </div>
                      )}
                      {i === 0 && (
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 text-[10px] rounded bg-black/60 text-white">
                          Primary
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500">No photos yet.</div>
              )}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onPickPhoto}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white focus:outline-none shadow-sm"
                >
                  <UploadSimple size={16} weight="bold" aria-hidden="true" />
                  <span>
                    {photos.length >= 1 ? "Add more photos" : "Add photo"}
                  </span>
                </button>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handlePhotoChange}
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Tip: Tap Reorder to drag photos; the first photo is used as your
                primary.
              </p>
            </div>
          </div>
        )}

        {/* Fields card */}
        {!isLoading && (
          <div className="bg-white rounded-2xl border p-4 space-y-4">
            {/* Username (read-only) */}
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-medium text-gray-800">
                  Username
                </div>
                <div className="text-gray-900 font-semibold break-words">
                  {username}
                </div>
              </div>
            </div>

            {/* Location */}
            <div>
              <div className="text-sm font-medium text-gray-800 mb-1">
                Location
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
                  placeholder="City"
                  {...register("location.city")}
                />
                <input
                  className="min-w-0 w-[120px] sm:w-[160px] rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
                  placeholder="State"
                  {...register("location.state")}
                />
              </div>
            </div>

            {/* Age */}
            <div>
              <div className="text-sm font-medium text-gray-800 mb-1">Age</div>
              <input
                type="number"
                min={18}
                max={99}
                className="w-32 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
                placeholder="Age"
                {...register("age", { valueAsNumber: true })}
              />
            </div>

            {/* Religion (chips) */}
            <div>
              <div className="text-sm font-medium text-gray-800 mb-1">
                Religion
              </div>
              <div className="flex flex-wrap gap-2">
                {/* Prefer not to say */}
                <button
                  type="button"
                  aria-pressed={!watch("religion")}
                  onClick={() =>
                    setValue("religion", "", { shouldDirty: true })
                  }
                  className={`px-3 py-1.5 rounded-full text-sm border transition ${
                    !watch("religion")
                      ? "bg-white text-red-600 border-red-500 ring-1 ring-red-300"
                      : "bg-white text-gray-700 border-gray-300"
                  }`}
                >
                  Prefer not to say
                </button>
                {RELIGION_OPTIONS.map((r) => {
                  const active = watch("religion") === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setValue("religion", r, { shouldDirty: true })
                      }
                      className={`px-3 py-1.5 rounded-full text-sm border transition ${
                        active
                          ? "bg-white text-red-600 border-red-500 ring-1 ring-red-300"
                          : "bg-white text-gray-700 border-gray-300"
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Headline (BottomSheet) */}
            <div>
              <div className="text-sm font-medium text-gray-800 mb-1">
                Profile headline
              </div>
              <button
                type="button"
                onClick={() => setShowHeadlineSheet(true)}
                className="w-full px-3 py-2 rounded-md border bg-white text-sm flex items-center justify-between"
              >
                <span className="truncate text-left">
                  {watch("mood") || "Select a headline"}
                </span>
                <span className="ml-3 inline-flex items-center text-gray-500">
                  {/* Caret down icon */}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-4 h-4"
                    aria-hidden="true"
                  >
                    <path d="M6.7 9.3a1 1 0 0 1 1.4 0L12 13.17l3.9-3.88a1 1 0 1 1 1.4 1.42l-4.6 4.59a1 1 0 0 1-1.4 0L6.7 10.7a1 1 0 0 1 0-1.4z" />
                  </svg>
                </span>
              </button>
            </div>

            {/* Preferences */}
            <div className="border-t pt-4">
              <div className="text-sm font-medium text-gray-500 mb-2">
                Preferences
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-medium text-gray-800">Age</span>
                <input
                  type="number"
                  min={18}
                  max={99}
                  className="w-20 rounded-md border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
                  {...register("preferences.age.min", { valueAsNumber: true })}
                />
                <span className="text-gray-500">–</span>
                <input
                  type="number"
                  min={18}
                  max={99}
                  className="w-20 rounded-md border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
                  {...register("preferences.age.max", { valueAsNumber: true })}
                />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-800 mb-1">
                  Religions
                </div>
                <div className="flex flex-wrap gap-2">
                  {PREF_RELIGIONS.map((r) => {
                    const active = prefReligions.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={active}
                        onClick={() => togglePrefReligion(r)}
                        className={`px-3 py-1.5 rounded-full text-sm border transition ${
                          active
                            ? "bg-white text-red-600 border-red-500 ring-1 ring-red-300"
                            : "bg-white text-gray-700 border-gray-300"
                        }`}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Divider + Danger zone (now at the bottom, after main form) */}
        {!isLoading && serverProfile && (
          <>
            <div className="my-4 border-t border-gray-200" aria-hidden="true" />
            <div>
              <div className="bg-white rounded-2xl border p-4">
                <div className="text-sm font-semibold text-gray-900 mb-2">
                  Danger zone
                </div>
                <p className="text-sm text-gray-600 mb-3">
                  Delete your dating profile and remove your presence from
                  discovery. This action cannot be undone.
                </p>
                <button
                  type="button"
                  onClick={() => setShowDeleteSheet(true)}
                  disabled={isDeleting || mutation.isPending}
                  className="w-full px-4 py-2 rounded-md bg-white border border-red-500 text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete profile
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      <BottomSheet
        isOpen={showHeadlineSheet}
        onClose={() => setShowHeadlineSheet(false)}
        title="Select interest"
      >
        <div
          className="divide-y divide-gray-200"
          role="radiogroup"
          aria-label="Profile headline"
        >
          {HEADLINE_OPTIONS.map((opt) => {
            const selected = watch("mood") === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  setValue("mood", opt, { shouldDirty: true });
                  setShowHeadlineSheet(false);
                }}
                role="radio"
                aria-checked={selected}
                className="w-full flex items-center justify-between py-3 text-left"
              >
                <span className="text-sm font-medium text-gray-800">{opt}</span>
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
      {/* Delete confirmation */}
      <BottomSheet
        isOpen={showDeleteSheet}
        onClose={() => setShowDeleteSheet(false)}
        title={
          <div className="w-full flex items-center justify-center gap-2">
            <Trash size={18} className="text-red-600" aria-hidden="true" />
            <span>Confirm deletion</span>
          </div>
        }
      >
        <div className="space-y-5">
          <p className="text-sm text-gray-600 text-center">
            This will permanently remove your dating profile and clear your
            related likes. This action cannot be undone.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setShowDeleteSheet(false)}
              disabled={isDeleting}
              className="min-w-[104px] px-4 py-2 rounded-md border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmDelete}
              disabled={isDeleting}
              className="min-w-[104px] px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </BottomSheet>
      {/* Discard changes confirmation */}
      <BottomSheet
        isOpen={showDiscardSheet}
        onClose={() => setShowDiscardSheet(false)}
        title={
          <div className="w-full flex items-center justify-center gap-2">
            <WarningCircle
              size={18}
              className="text-red-600"
              aria-hidden="true"
            />
            <span>Discard changes?</span>
          </div>
        }
      >
        <div className="space-y-5">
          <p className="text-sm text-gray-600 text-center">
            You have unsaved changes. Are you sure you want to discard them?
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setShowDiscardSheet(false)}
              className="min-w-[104px] px-4 py-2 rounded-md border border-gray-300 bg-white text-gray-900 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="min-w-[140px] px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700"
            >
              Discard
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};

export default EditDatingProfile;
