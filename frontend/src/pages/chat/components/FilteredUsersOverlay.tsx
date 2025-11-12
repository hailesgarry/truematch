import React from "react";
import { X } from "@phosphor-icons/react";
import FullscreenOverlay from "../../../components/ui/FullscreenOverlay";
import Modal from "../../../components/common/Modal";
import type { FilterEntry } from "../../../stores/messageFilterStore";
import { normalizeUsernameKey, coerceTimestampValueToMs } from "../utils";

type FilteredUsersOverlayProps = {
  open: boolean;
  entries: FilterEntry[];
  removingKey: string | null;
  onClose: () => void;
  onShowOptions: (username: string) => void;
  onRemove: (entry: FilterEntry) => void;
  filterModalOpen: boolean;
  filterModalTarget: string;
  filterModalIsActive: boolean;
  onConfirmFilterChoice: () => void;
  onCancelFilterChoice: () => void;
};

const FilteredUsersOverlay: React.FC<FilteredUsersOverlayProps> = ({
  open,
  entries,
  removingKey,
  onClose,
  onShowOptions,
  onRemove,
  filterModalOpen,
  filterModalTarget,
  filterModalIsActive,
  onConfirmFilterChoice,
  onCancelFilterChoice,
}) => {
  const filterModalTitle = filterModalTarget
    ? filterModalIsActive
      ? `Show ${filterModalTarget}'s messages`
      : `Filter out ${filterModalTarget}`
    : "Filter user";

  return (
    <>
      <FullscreenOverlay isOpen={open} onClose={onClose}>
        <div className="w-full max-w-2xl mx-auto px-4 py-6 space-y-6">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Filtered users
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Messages from these people stay hidden starting from when you
                filtered them. You can show their messages again at any time.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-2 text-gray-500 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
              aria-label="Close filtered users"
            >
              <X size={20} weight="bold" />
            </button>
          </header>

          {entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-600">
              You are not filtering anyone in this chat.
            </div>
          ) : (
            <ul className="space-y-3">
              {entries.map((entry, index) => {
                const normalized =
                  normalizeUsernameKey(entry.normalized) ||
                  normalizeUsernameKey(entry.username);
                const appliedAt =
                  coerceTimestampValueToMs(entry.createdAt) ?? Date.now();
                const appliedLabel = new Date(appliedAt).toLocaleString(
                  undefined,
                  {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }
                );
                const isRemoving =
                  removingKey != null && normalized === removingKey;

                return (
                  <li
                    key={`${normalized || index}-${appliedAt}`}
                    data-filtered-user={normalized || undefined}
                  >
                    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">
                          {entry.username}
                        </div>
                        <div className="text-xs text-gray-500">
                          Filtered since {appliedLabel}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onShowOptions(entry.username || "")}
                          className="inline-flex items-center justify-center rounded-md px-3 py-2 text-xs font-medium text-gray-600 hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                        >
                          View options
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemove(entry)}
                          disabled={isRemoving}
                          className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-xs font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                            isRemoving
                              ? "bg-blue-300 cursor-wait"
                              : "bg-blue-600 hover:bg-blue-700"
                          }`}
                        >
                          {isRemoving ? "Working…" : "Show messages"}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </FullscreenOverlay>

      <Modal
        isOpen={filterModalOpen}
        onClose={onCancelFilterChoice}
        size="sm"
        centered
        title={filterModalTitle}
      >
        <div className="space-y-4 text-sm text-gray-600">
          <p>
            {filterModalTarget
              ? filterModalIsActive
                ? `Messages from ${filterModalTarget} are hidden for you in this chat. Choose "Show messages" to include them again.`
                : `Hide messages from ${filterModalTarget} in this chat. You can undo this any time.`
              : "Choose a person to filter."}
          </p>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
            This only changes what you see. Everyone else still sees their
            messages.
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onConfirmFilterChoice}
              className={`w-full sm:w-auto inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                filterModalIsActive
                  ? "bg-blue-600 hover:bg-blue-700 focus-visible:outline-blue-500"
                  : "bg-red-600 hover:bg-red-700 focus-visible:outline-red-500"
              }`}
            >
              {filterModalIsActive ? "Show messages" : "Filter out messages"}
            </button>
            <button
              type="button"
              onClick={onCancelFilterChoice}
              className="w-full sm:w-auto inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-gray-700 transition bg-gray-100 hover:bg-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default FilteredUsersOverlay;
