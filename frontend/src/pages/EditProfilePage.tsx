import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CaretDown,
  PencilSimple,
  Trash,
  User,
} from "phosphor-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import FullscreenOverlay from "../components/ui/FullscreenOverlay";
import ActionButtons from "../components/ui/ActionButtons";
import Field, { fieldControlClasses } from "../components/ui/Field";
import Modal from "../components/common/Modal";
import PageHeader from "../components/common/PageHeader";
import ValidatedField from "../components/form/ValidatedField";
import {
  currentProfileKey,
  useCurrentProfile,
} from "../hooks/useCurrentProfile";
import { useAuthStore } from "../stores/authStore";
import { useAvatarStore } from "../stores/avatarStore";
import { updateMyProfile, uploadAvatar } from "../services/api";

type ActiveEditor = "username" | "link-account" | null;

const ACCOUNT_TYPE_OPTIONS = [
  "Tik Tok",
  "Twitter",
  "Instagram",
  "Facebook",
] as const;

type LinkedAccount = {
  platform: (typeof ACCOUNT_TYPE_OPTIONS)[number];
  url: string;
};

type LinkedAccountParseResult = {
  accounts: LinkedAccount[];
  remainder: string[];
};

const LINKED_ACCOUNT_MARKER = "linked-social-account";

const encodeLinkedAccount = (account: LinkedAccount): string => {
  return JSON.stringify({
    marker: LINKED_ACCOUNT_MARKER,
    v: 1,
    platform: account.platform,
    url: account.url,
  });
};

const decodeLinkedAccount = (raw: string): LinkedAccount | null => {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const marker = (parsed as any)?.marker;
    const platform = (parsed as any)?.platform;
    const url = (parsed as any)?.url;
    if (marker !== LINKED_ACCOUNT_MARKER) return null;
    if (!ACCOUNT_TYPE_OPTIONS.includes(platform)) return null;
    if (typeof url !== "string" || !url.trim()) return null;
    return { platform, url };
  } catch (error) {
    if (raw.trim().startsWith("{")) {
      console.warn("Failed to parse linked account entry", error);
    }
    return null;
  }
};

const splitLinkedAccountEntries = (
  source?: string[] | null
): LinkedAccountParseResult => {
  const entries = Array.isArray(source) ? source : [];
  const accounts: LinkedAccount[] = [];
  const remainder: string[] = [];
  for (const item of entries) {
    const decoded = decodeLinkedAccount(item);
    if (decoded) {
      accounts.push(decoded);
    } else if (typeof item === "string") {
      remainder.push(item);
    }
  }
  return { accounts, remainder };
};

const serializeLinkedAccounts = (accounts: LinkedAccount[]): string[] => {
  return accounts.map(encodeLinkedAccount);
};

const linkAccountSchema = z.object({
  accountType: z.enum(ACCOUNT_TYPE_OPTIONS, {
    errorMap: () => ({
      message: "Choose one of the supported platforms.",
    }),
  }),
  accountUrl: z
    .string()
    .trim()
    .min(1, "Profile URL is required.")
    .url("Enter a valid URL.")
    .refine((value) => value.startsWith("https://"), {
      message: "URL must start with https://",
    }),
});

type LinkAccountFormValues = z.infer<typeof linkAccountSchema>;

const EditProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { userId: routeUserIdParam = "" } = useParams<{ userId?: string }>();
  const routeUserId = (routeUserIdParam || "").trim();
  const { profile, isLoading } = useCurrentProfile();
  const myProfileUserId = profile?.userId || "";
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const authUsername = useAuthStore((state) => state.username);
  const setAuthAvatar = useAuthStore((state) => state.setAvatar);
  const setCachedAvatar = useAvatarStore((state) => state.setAvatar);
  const [activeEditor, setActiveEditor] = useState<ActiveEditor>(null);
  const [usernameDraft, setUsernameDraft] = useState<string>("");
  const [isAccountTypeModalOpen, setIsAccountTypeModalOpen] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [linkAccountEditIndex, setLinkAccountEditIndex] = useState<
    number | null
  >(null);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(
    null
  );
  const [isDeletingLinkedAccount, setIsDeletingLinkedAccount] = useState(false);

  const {
    control: linkAccountControl,
    handleSubmit: submitLinkAccountForm,
    reset: resetLinkAccountForm,
    setValue: setLinkAccountValue,
    watch: watchLinkAccountForm,
    formState: {
      isValid: isLinkAccountFormValid,
      isSubmitting: isLinkAccountFormSubmitting,
    },
  } = useForm<LinkAccountFormValues>({
    resolver: zodResolver(linkAccountSchema),
    defaultValues: {
      accountType: undefined,
      accountUrl: "",
    },
    mode: "onChange",
  });

  const selectedAccountType = watchLinkAccountForm("accountType");

  const avatarUrl = profile?.avatarUrl || null;
  const username = profile?.username || "";
  const displayAvatar = avatarPreview ?? avatarUrl ?? null;

  const { accounts: linkedAccounts } = useMemo(
    () => splitLinkedAccountEntries(profile?.friends),
    [profile?.friends]
  );

  const pendingDeleteAccount =
    pendingDeleteIndex != null && pendingDeleteIndex >= 0
      ? linkedAccounts[pendingDeleteIndex] ?? null
      : null;

  useEffect(() => {
    if (pendingDeleteIndex != null && pendingDeleteAccount == null) {
      setPendingDeleteIndex(null);
    }
  }, [pendingDeleteAccount, pendingDeleteIndex, setPendingDeleteIndex]);

  const closeOverlay = useCallback(() => {
    setActiveEditor(null);
    setIsAccountTypeModalOpen(false);
    setLinkAccountEditIndex(null);
    resetLinkAccountForm({
      accountType: undefined,
      accountUrl: "",
    } as Partial<LinkAccountFormValues>);
  }, [
    resetLinkAccountForm,
    setActiveEditor,
    setIsAccountTypeModalOpen,
    setLinkAccountEditIndex,
  ]);

  const openUsernameEditor = useCallback(() => {
    setUsernameDraft(username.trim());
    setActiveEditor("username");
  }, [setActiveEditor, username]);

  const openLinkAccountEditor = useCallback(
    (index: number | null = null) => {
      const account = index != null ? linkedAccounts[index] : null;
      resetLinkAccountForm({
        accountType: account?.platform ?? undefined,
        accountUrl: account?.url ?? "",
      } as Partial<LinkAccountFormValues>);
      setLinkAccountEditIndex(index);
      setIsAccountTypeModalOpen(false);
      setActiveEditor("link-account");
    },
    [
      linkedAccounts,
      resetLinkAccountForm,
      setActiveEditor,
      setIsAccountTypeModalOpen,
      setLinkAccountEditIndex,
    ]
  );

  const requestDeleteLinkedAccount = useCallback(
    (index: number) => {
      setPendingDeleteIndex(index);
    },
    [setPendingDeleteIndex]
  );

  const handleCancelDelete = () => {
    if (isDeletingLinkedAccount) return;
    setPendingDeleteIndex(null);
  };

  const confirmDeleteLinkedAccount = async () => {
    if (pendingDeleteIndex == null || !token) return;
    setIsDeletingLinkedAccount(true);
    try {
      const { accounts, remainder } = splitLinkedAccountEntries(
        profile?.friends
      );
      if (pendingDeleteIndex < 0 || pendingDeleteIndex >= accounts.length) {
        setPendingDeleteIndex(null);
        return;
      }

      const nextAccounts = accounts.filter(
        (_, index) => index !== pendingDeleteIndex
      );

      const updated = await updateMyProfile(token, {
        friends: [...serializeLinkedAccounts(nextAccounts), ...remainder],
      });

      queryClient.setQueryData(currentProfileKey, updated);
      await queryClient.invalidateQueries({ queryKey: currentProfileKey });
      setPendingDeleteIndex(null);
    } catch (error) {
      console.error("Failed to remove linked account", error);
    } finally {
      setIsDeletingLinkedAccount(false);
    }
  };

  const handleAvatarButtonClick = useCallback(() => {
    if (isUploadingAvatar) return;
    fileInputRef.current?.click();
  }, [isUploadingAvatar]);

  const handleAvatarChange: React.ChangeEventHandler<HTMLInputElement> =
    useCallback(
      async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || !token) return;
        setIsUploadingAvatar(true);
        try {
          const { url } = await uploadAvatar(file);
          const updated = await updateMyProfile(token, {
            avatarUrl: url,
          });
          const newUrl = updated.avatarUrl || url || null;
          setAvatarPreview(newUrl);
          setAuthAvatar(newUrl);
          const effectiveUsername = (
            updated.username ||
            username ||
            authUsername ||
            ""
          ).trim();
          if (effectiveUsername && newUrl) {
            setCachedAvatar(effectiveUsername, newUrl);
          }
          queryClient.setQueryData(currentProfileKey, updated);
          await queryClient.invalidateQueries({ queryKey: currentProfileKey });
        } catch (error) {
          console.error("Failed to update avatar", error);
        } finally {
          setIsUploadingAvatar(false);
        }
      },
      [
        token,
        queryClient,
        setAuthAvatar,
        setCachedAvatar,
        username,
        authUsername,
      ]
    );

  const handleUsernameSubmit: React.FormEventHandler<HTMLFormElement> = (
    event
  ) => {
    event.preventDefault();
    closeOverlay();
  };

  const handleLinkAccountSubmit = submitLinkAccountForm(async (values) => {
    if (!token) return;
    try {
      const { accounts, remainder } = splitLinkedAccountEntries(
        profile?.friends
      );
      const nextAccounts =
        linkAccountEditIndex != null
          ? accounts.map((account, index) =>
              index === linkAccountEditIndex
                ? {
                    platform: values.accountType,
                    url: values.accountUrl,
                  }
                : account
            )
          : [
              ...accounts,
              { platform: values.accountType, url: values.accountUrl },
            ];

      const updated = await updateMyProfile(token, {
        friends: [...serializeLinkedAccounts(nextAccounts), ...remainder],
      });

      queryClient.setQueryData(currentProfileKey, updated);
      await queryClient.invalidateQueries({ queryKey: currentProfileKey });
      closeOverlay();
    } catch (error) {
      console.error("Failed to save linked account", error);
    }
  });

  useEffect(() => {
    if (isLoading) return;
    if (!myProfileUserId) return;
    if (!routeUserId || routeUserId === "me") {
      navigate(`/edit-profile/${encodeURIComponent(myProfileUserId)}`, {
        replace: true,
      });
      return;
    }
    if (routeUserId !== myProfileUserId) {
      navigate(`/profile/${encodeURIComponent(routeUserId)}`, {
        replace: true,
      });
    }
  }, [isLoading, myProfileUserId, routeUserId, navigate]);

  const renderOverlayContent = () => {
    if (activeEditor === "username") {
      const hasChanges = usernameDraft.trim() !== username.trim();
      return (
        <form className="flex h-full flex-col" onSubmit={handleUsernameSubmit}>
          <div className="flex-1 space-y-6">
            <Field label="Name" htmlFor="profile-username">
              <input
                id="profile-username"
                type="text"
                className={fieldControlClasses}
                value={usernameDraft}
                onChange={(event) => setUsernameDraft(event.target.value)}
                autoComplete="nickname"
                autoFocus
              />
            </Field>
          </div>
          <ActionButtons
            className="mt-8"
            primaryText="Save"
            secondaryText="Cancel"
            onSecondary={closeOverlay}
            primaryDisabled={!hasChanges || usernameDraft.trim().length === 0}
          />
        </form>
      );
    }

    if (activeEditor === "link-account") {
      const isEditingLinkAccount = linkAccountEditIndex != null;
      return (
        <>
          <form
            className="flex h-full flex-col"
            onSubmit={handleLinkAccountSubmit}
          >
            <div className="flex-1 space-y-6 overflow-y-auto pb-8">
              <ValidatedField
                control={linkAccountControl}
                name="accountType"
                label="Account type"
                hint="Select a platform from the list."
                required
                render={({ field, inputProps }) => {
                  const selectedValue =
                    typeof field.value === "string" ? field.value : "";
                  const hasSelection = selectedValue.length > 0;
                  return (
                    <button
                      type="button"
                      id={inputProps.id}
                      onClick={() => setIsAccountTypeModalOpen(true)}
                      onBlur={field.onBlur}
                      className={`${fieldControlClasses} flex items-center justify-between bg-white text-left`}
                      aria-haspopup="dialog"
                      aria-expanded={isAccountTypeModalOpen}
                      aria-invalid={inputProps["aria-invalid"]}
                      aria-describedby={inputProps["aria-describedby"]}
                    >
                      <span
                        className={`$
                          hasSelection
                            ? "text-gray-900"
                            : "italic text-gray-400"
                        } flex-1 min-w-0 text-left truncate`}
                        aria-hidden={hasSelection ? undefined : false}
                      >
                        {hasSelection ? selectedValue : "Select a platform"}
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

              <ValidatedField
                control={linkAccountControl}
                name="accountUrl"
                label="Profile URL"
                hint="Use your public profile link and include the https:// prefix."
                required
                render={({ field, inputProps }) => (
                  <input
                    {...field}
                    id={inputProps.id}
                    aria-invalid={inputProps["aria-invalid"]}
                    aria-describedby={inputProps["aria-describedby"]}
                    type="url"
                    inputMode="url"
                    className={fieldControlClasses}
                    placeholder="https://"
                    value={field.value ?? ""}
                  />
                )}
              />
            </div>

            <div className="mt-auto">
              <ActionButtons
                className="mt-8"
                secondaryText="Cancel"
                onSecondary={closeOverlay}
                primaryText={isEditingLinkAccount ? "Update" : "Save"}
                primaryDisabled={
                  !isLinkAccountFormValid || isLinkAccountFormSubmitting
                }
              />
            </div>
          </form>

          <Modal
            isOpen={isAccountTypeModalOpen}
            onClose={() => setIsAccountTypeModalOpen(false)}
            title="Account type"
            size="sm"
            closeOnOverlayClick
          >
            <fieldset className="space-y-1" role="radiogroup">
              <legend className="sr-only">Choose account type</legend>
              {ACCOUNT_TYPE_OPTIONS.map((option, index) => {
                const isActive = selectedAccountType === option;
                const isAlreadyLinked = linkedAccounts.some(
                  (account, accountIndex) =>
                    account.platform === option &&
                    (linkAccountEditIndex == null ||
                      accountIndex !== linkAccountEditIndex)
                );
                return (
                  <label
                    key={option}
                    className={`flex items-center gap-3 rounded-lg px-1 py-2 text-sm transition-colors ${
                      isAlreadyLinked
                        ? "cursor-not-allowed text-gray-400"
                        : "cursor-pointer text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="link-account-type"
                      value={option}
                      checked={isActive}
                      onChange={() => {
                        if (isAlreadyLinked) return;
                        setLinkAccountValue("accountType", option, {
                          shouldDirty: true,
                          shouldValidate: true,
                          shouldTouch: true,
                        });
                        setIsAccountTypeModalOpen(false);
                      }}
                      className="h-4 w-4 accent-red-500"
                      disabled={isAlreadyLinked}
                      data-autofocus={index === 0 ? true : undefined}
                    />
                    <span
                      className={
                        isActive
                          ? "font-semibold text-gray-900"
                          : isAlreadyLinked
                          ? "text-gray-400"
                          : "text-gray-900"
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
    }

    return (
      <p className="text-sm text-gray-600">
        We will add the editing experience for this section soon.
      </p>
    );
  };

  type LinkRow = {
    key: string;
    label: string;
    value: React.ReactNode;
    onEdit: () => void;
    onDelete?: () => void;
  };

  const linkRows: LinkRow[] =
    linkedAccounts.length === 0
      ? [
          {
            key: "link-account-empty",
            label: "Link account",
            value: "Not linked",
            onEdit: () => openLinkAccountEditor(null),
          },
        ]
      : [
          ...linkedAccounts.map(
            (account, index): LinkRow => ({
              key: `linked-account-${account.platform}-${index}`,
              label: account.platform,
              value: (
                <a
                  href={account.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-500 hover:underline"
                >
                  {account.url}
                </a>
              ),
              onEdit: () => openLinkAccountEditor(index),
              onDelete: () => requestDeleteLinkedAccount(index),
            })
          ),
          {
            key: "link-account-add-more",
            label: "Link more account",
            value: "Not linked",
            onEdit: () => openLinkAccountEditor(null),
          },
        ];

  return (
    <div className="min-h-screen bg-white">
      <PageHeader
        title="Edit Profile"
        onBack={() => navigate(-1)}
        backIconSize={22}
        containerClassName="max-w-md mx-auto px-4"
      />

      <main className="w-full max-w-md mx-auto px-4 pb-12">
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            {displayAvatar ? (
              <img
                src={displayAvatar}
                alt={username ? `${username}'s avatar` : "User avatar"}
                className={`h-32 w-32 rounded-full object-cover ${
                  isUploadingAvatar ? "opacity-60" : ""
                }`}
              />
            ) : (
              <div
                className={`flex h-32 w-32 items-center justify-center rounded-full bg-gray-200 ${
                  isUploadingAvatar ? "opacity-60" : ""
                }`}
              >
                <User size={44} className="text-gray-500" />
              </div>
            )}
            <button
              type="button"
              onClick={handleAvatarButtonClick}
              disabled={isUploadingAvatar}
              className="absolute bottom-0 right-0 flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-700 shadow focus:outline-none disabled:opacity-50"
              aria-label="Change profile photo"
            >
              <PencilSimple size={22} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            {isUploadingAvatar ? (
              <div
                className="absolute inset-0 rounded-full bg-white/30"
                aria-hidden
              />
            ) : null}
          </div>
        </div>

        <section className="mt-10">
          <div className="rounded-2xl border border-gray-200 bg-white">
            <ProfileRow
              label="Name"
              value={username || (isLoading ? "" : "Not set")}
              loading={isLoading}
              onEdit={openUsernameEditor}
            />
            {linkRows.map((row) => (
              <React.Fragment key={row.key}>
                <div className="mx-5 h-px bg-gray-100" />
                <ProfileRow
                  label={row.label}
                  value={row.value}
                  loading={isLoading}
                  onEdit={row.onEdit}
                  onDelete={row.onDelete}
                />
              </React.Fragment>
            ))}
          </div>
        </section>
      </main>

      <FullscreenOverlay isOpen={activeEditor !== null} onClose={closeOverlay}>
        <div className="flex min-h-full flex-col bg-white">
          <header className="sticky top-0 z-10 flex h-12 items-center bg-white px-4">
            <button
              type="button"
              onClick={closeOverlay}
              className="flex items-center justify-center"
              aria-label="Close"
            >
              <ArrowLeft size={22} className="text-gray-900" />
            </button>
          </header>

          <div className="flex-1 px-4 py-6">{renderOverlayContent()}</div>
        </div>
      </FullscreenOverlay>

      <Modal
        isOpen={pendingDeleteAccount != null}
        onClose={handleCancelDelete}
        title="Remove linked account"
        size="sm"
        closeOnOverlayClick={!isDeletingLinkedAccount}
        closeOnEsc={!isDeletingLinkedAccount}
      >
        {pendingDeleteAccount ? (
          <>
            <p className="text-sm text-gray-600">
              Remove your {pendingDeleteAccount.platform} profile link?
            </p>
            <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 break-all">
              {pendingDeleteAccount.url}
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-600">Remove this linked account?</p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleCancelDelete}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isDeletingLinkedAccount}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmDeleteLinkedAccount}
            className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isDeletingLinkedAccount}
          >
            {isDeletingLinkedAccount ? "Removing..." : "Remove"}
          </button>
        </div>
      </Modal>
    </div>
  );
};

type ProfileRowProps = {
  label: string;
  value: React.ReactNode;
  loading?: boolean;
  onEdit: () => void;
  onDelete?: () => void;
};

const ProfileRow: React.FC<ProfileRowProps> = ({
  label,
  value,
  loading = false,
  onEdit,
  onDelete,
}) => {
  const actionButtonClasses =
    "flex items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="px-5 py-4">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      {loading ? (
        <span className="mt-2 block h-4 w-28 animate-pulse rounded bg-gray-200" />
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 break-all text-sm text-gray-900">{value}</div>
          <div className="flex items-center gap-2">
            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className={`${actionButtonClasses} text-red-500`}
                aria-label={`Remove ${label}`}
                title={`Remove ${label}`}
              >
                <Trash size={22} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onEdit}
              className={`${actionButtonClasses} text-gray-500`}
              aria-label={`Edit ${label}`}
              title={`Edit ${label}`}
            >
              <PencilSimple size={22} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditProfilePage;
