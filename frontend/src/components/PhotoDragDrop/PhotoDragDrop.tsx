import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { Trash } from "phosphor-react";

export type PhotoDragDropPhoto = {
  id: string;
  src: string;
  alt?: string;
};

export type PhotoDragDropAssignments = Record<string, string>;

export type PhotoDragDropSection = {
  id: string;
  label: string;
  description?: string;
  content?: React.ReactNode;
  photosEnabled?: boolean;
};

type DraggablePhotoComponent = React.FC<{
  photo: PhotoDragDropPhoto;
  className?: string;
  isViewerMode?: boolean;
}>;

type RenderDropZoneOptions = {
  className?: string;
  emptyState?: React.ReactNode;
  renderPhotos?: (input: {
    photos: PhotoDragDropPhoto[];
    DraggablePhoto: DraggablePhotoComponent;
    isViewerMode: boolean;
  }) => React.ReactNode;
};

type RenderAvailableContext = {
  photos: PhotoDragDropPhoto[];
  renderDropZone: (options?: RenderDropZoneOptions) => React.ReactNode;
  DraggablePhoto: DraggablePhotoComponent;
  isInteractive: boolean;
};

export type PhotoDragDropProps = {
  photos: PhotoDragDropPhoto[];
  sections: Array<PhotoDragDropSection | string>;
  onDrop: (payload: {
    photo: PhotoDragDropPhoto;
    sectionId: string;
    sectionLabel: string;
    assignments: PhotoDragDropAssignments;
  }) => void;
  className?: string;
  availableLabel?: string;
  availableDescription?: string;
  isInteractive?: boolean;
  renderAvailable?: (context: RenderAvailableContext) => React.ReactNode;
  initialAssignments?: PhotoDragDropAssignments;
  onDeletePhoto?: (photo: PhotoDragDropPhoto) => void;
  deletingPhotoIds?: ReadonlySet<string>;
};

export const PHOTO_DRAG_DROP_AVAILABLE_ID = "__available-photos__";

const slugify = (value: string, fallback: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return normalized || fallback;
};

type NormalizedSection = PhotoDragDropSection & {
  isAvailable?: boolean;
};

type PhotoAssignments = PhotoDragDropAssignments;

const PhotoCard: React.FC<{
  photo: PhotoDragDropPhoto;
  className?: string;
  style?: React.CSSProperties;
  isInteractive: boolean;
  isViewerMode: boolean;
  onDelete?: () => void;
  isDeleting?: boolean;
}> = ({
  photo,
  className,
  style,
  isInteractive,
  isViewerMode,
  onDelete,
  isDeleting,
}) => (
  <div
    className={clsx(
      "relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 transition-colors",
      isInteractive
        ? "cursor-grab touch-none border-2 border-dashed border-gray-300"
        : isViewerMode
        ? "cursor-default border border-transparent"
        : "cursor-default border-2 border-dashed border-gray-300",
      className
    )}
    style={style}
  >
    <img
      src={photo.src}
      alt={photo.alt ?? "Profile photo"}
      draggable={false}
      className="h-full w-full select-none object-cover"
    />
    {onDelete ? (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isDeleting) {
            return;
          }
          onDelete();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        disabled={isDeleting}
        className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        aria-label="Delete photo"
      >
        {isDeleting ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-red-500/70 border-t-transparent" />
        ) : (
          <Trash size={18} weight="bold" aria-hidden="true" />
        )}
      </button>
    ) : null}
    {isDeleting ? (
      <div className="absolute inset-0 bg-black/35" aria-hidden="true" />
    ) : null}
  </div>
);

const DraggablePhotoCard: React.FC<{
  photo: PhotoDragDropPhoto;
  isInteractive: boolean;
  isViewerMode: boolean;
  className?: string;
  onDelete?: (photo: PhotoDragDropPhoto) => void;
  isDeleting?: boolean;
}> = ({
  photo,
  isInteractive,
  isViewerMode,
  className,
  onDelete,
  isDeleting,
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: photo.id,
      disabled: !isInteractive,
    });

  const style: React.CSSProperties = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    transition: isDragging ? undefined : "transform 180ms ease",
    visibility: isDragging ? "hidden" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={style}
      className={clsx(
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
        className
      )}
    >
      <PhotoCard
        photo={photo}
        isInteractive={isInteractive}
        isViewerMode={isViewerMode}
        onDelete={isInteractive && onDelete ? () => onDelete(photo) : undefined}
        isDeleting={isDeleting}
      />
    </div>
  );
};

const DropZone: React.FC<{
  section: NormalizedSection;
  photos: PhotoDragDropPhoto[];
  isInteractive: boolean;
  draggableComponent: DraggablePhotoComponent;
  className?: string;
  emptyState?: React.ReactNode;
  renderPhotos?: (input: {
    photos: PhotoDragDropPhoto[];
    DraggablePhoto: DraggablePhotoComponent;
    isViewerMode: boolean;
  }) => React.ReactNode;
  isViewerMode: boolean;
}> = ({
  section,
  photos,
  isInteractive,
  draggableComponent: DraggablePhoto,
  className,
  emptyState,
  renderPhotos,
  isViewerMode,
}) => {
  const { isOver, setNodeRef } = useDroppable({ id: section.id });
  const hasPhotos = photos.length > 0;

  const emptyMessage = section.isAvailable
    ? isInteractive
      ? ""
      : "No photos available."
    : isInteractive
    ? "Drop a photo here to feature it below this section."
    : "No photos assigned yet.";

  const defaultEmpty = emptyMessage ? (
    <p className="text-center text-sm text-gray-500">{emptyMessage}</p>
  ) : null;

  const photoContent = renderPhotos ? (
    renderPhotos({ photos, DraggablePhoto, isViewerMode })
  ) : (
    <div className="space-y-4">
      {photos.map((photo) => (
        <DraggablePhoto
          key={photo.id}
          photo={photo}
          isViewerMode={isViewerMode}
        />
      ))}
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      aria-label={section.label}
      className={clsx(
        "rounded-2xl transition-colors",
        hasPhotos
          ? "overflow-hidden border border-transparent"
          : "border-2 border-dashed border-gray-200 bg-gray-50 p-4",
        isOver && !hasPhotos ? "border-red-400 bg-red-50" : undefined,
        isOver && hasPhotos ? "ring-2 ring-red-400 ring-offset-2" : undefined,
        className
      )}
    >
      {hasPhotos ? photoContent : emptyState ?? defaultEmpty}
    </div>
  );
};

const PhotoDragDrop: React.FC<PhotoDragDropProps> = ({
  photos,
  sections,
  onDrop,
  className,
  availableLabel = "Available photos",
  availableDescription,
  isInteractive = true,
  renderAvailable,
  initialAssignments,
  onDeletePhoto,
  deletingPhotoIds,
}) => {
  const normalizedSections: NormalizedSection[] = useMemo(() => {
    return sections.map((entry, index) => {
      if (typeof entry === "string") {
        return {
          id: slugify(entry, `section-${index}`),
          label: entry,
        };
      }
      return entry;
    });
  }, [sections]);

  const availableSection = useMemo<NormalizedSection>(
    () => ({
      id: PHOTO_DRAG_DROP_AVAILABLE_ID,
      label: availableLabel,
      description:
        availableDescription ??
        (photos.length
          ? "Drag a photo card into a section below to highlight it."
          : "Add photos to start organizing them."),
      isAvailable: true,
    }),
    [availableDescription, availableLabel, photos.length]
  );

  const allSections = useMemo(
    () => [availableSection, ...normalizedSections],
    [availableSection, normalizedSections]
  );

  const sectionIdSet = useMemo(
    () => new Set(allSections.map((section) => section.id)),
    [allSections]
  );

  const [assignments, setAssignments] = useState<PhotoAssignments>(() => {
    const initial: PhotoAssignments = {};
    for (const photo of photos) {
      const preferred = initialAssignments?.[photo.id];
      initial[photo.id] =
        preferred && sectionIdSet.has(preferred)
          ? preferred
          : PHOTO_DRAG_DROP_AVAILABLE_ID;
    }
    return initial;
  });

  // Keep photo assignments in sync with the latest photo list and section ids.
  useEffect(() => {
    setAssignments((current) => {
      const next: PhotoAssignments = {};
      for (const photo of photos) {
        const preferred = initialAssignments?.[photo.id];
        if (preferred && sectionIdSet.has(preferred)) {
          next[photo.id] = preferred;
          continue;
        }
        const currentSection = current[photo.id];
        next[photo.id] =
          currentSection && sectionIdSet.has(currentSection)
            ? currentSection
            : PHOTO_DRAG_DROP_AVAILABLE_ID;
      }
      return next;
    });
  }, [photos, sectionIdSet, initialAssignments]);

  const photosBySection = useMemo(() => {
    const grouped: Record<string, PhotoDragDropPhoto[]> = {};
    for (const section of allSections) {
      grouped[section.id] = [];
    }
    for (const photo of photos) {
      const sectionId = assignments[photo.id];
      const safeSection =
        sectionId && sectionIdSet.has(sectionId)
          ? sectionId
          : PHOTO_DRAG_DROP_AVAILABLE_ID;
      grouped[safeSection].push(photo);
    }
    for (const section of allSections) {
      grouped[section.id].reverse();
    }
    return grouped;
  }, [allSections, assignments, photos, sectionIdSet]);

  const photoLookup = useMemo(() => {
    const map = new Map<string, PhotoDragDropPhoto>();
    for (const photo of photos) {
      map.set(photo.id, photo);
    }
    return map;
  }, [photos]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 120,
        tolerance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const [activeId, setActiveId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      if (!over) {
        return;
      }
      const activePhotoId = String(active.id);
      const destinationId = String(over.id);
      if (!sectionIdSet.has(destinationId)) {
        return;
      }

      const previousAssignment = assignments[activePhotoId];
      if (previousAssignment === destinationId) {
        return;
      }

      const nextAssignments: PhotoAssignments = {
        ...assignments,
        [activePhotoId]: destinationId,
      };
      setAssignments(nextAssignments);

      const photo = photoLookup.get(activePhotoId);
      const section = allSections.find((item) => item.id === destinationId);
      if (photo && section) {
        onDrop({
          photo,
          sectionId: section.id,
          sectionLabel: section.label,
          assignments: nextAssignments,
        });
      }
    },
    [allSections, assignments, onDrop, photoLookup, sectionIdSet]
  );

  const activePhoto = activeId ? photoLookup.get(activeId) ?? null : null;

  const availablePhotos = photosBySection[availableSection.id] ?? [];

  const DraggablePhoto: DraggablePhotoComponent = useCallback(
    ({ photo, className, isViewerMode }) => (
      <DraggablePhotoCard
        photo={photo}
        isInteractive={isInteractive}
        isViewerMode={isViewerMode ?? !isInteractive}
        className={className}
        onDelete={
          isInteractive && typeof onDeletePhoto === "function"
            ? onDeletePhoto
            : undefined
        }
        isDeleting={Boolean(deletingPhotoIds?.has(photo.id))}
      />
    ),
    [deletingPhotoIds, isInteractive, onDeletePhoto]
  );

  const renderDropZone = useCallback<RenderAvailableContext["renderDropZone"]>(
    (options) => (
      <DropZone
        section={availableSection}
        photos={availablePhotos}
        isInteractive={isInteractive}
        draggableComponent={DraggablePhoto}
        className={options?.className}
        emptyState={options?.emptyState}
        renderPhotos={options?.renderPhotos}
        isViewerMode={!isInteractive}
      />
    ),
    [DraggablePhoto, availablePhotos, availableSection, isInteractive]
  );

  const availableContent = useMemo(() => {
    if (typeof renderAvailable === "function") {
      return renderAvailable({
        photos: availablePhotos,
        renderDropZone,
        DraggablePhoto,
        isInteractive,
      });
    }

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {availableSection.label}
            </h2>
            {availableSection.description ? (
              <p className="text-sm text-gray-500">
                {availableSection.description}
              </p>
            ) : null}
          </div>
          {photos.length ? (
            <span className="text-sm text-gray-500">
              {photos.length} photo{photos.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        {renderDropZone()}
      </div>
    );
  }, [
    availablePhotos,
    availableSection,
    photos.length,
    renderAvailable,
    renderDropZone,
    DraggablePhoto,
    isInteractive,
  ]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <div className={clsx("space-y-10", className)}>
        {availableContent}

        {normalizedSections.map((section) => {
          const sectionPhotos = photosBySection[section.id];
          const hasSectionPhotos = sectionPhotos.length > 0;
          const photosAllowed =
            section.isAvailable || section.photosEnabled !== false;
          const shouldRenderDropZone =
            (photosAllowed &&
              ((isInteractive && photos.length > 0) || hasSectionPhotos)) ||
            (!photosAllowed && hasSectionPhotos);

          return (
            <div key={section.id} className="space-y-4">
              {section.content ?? (
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {section.label}
                  </h3>
                  {section.description ? (
                    <p className="text-sm text-gray-500">
                      {section.description}
                    </p>
                  ) : null}
                </div>
              )}
              {shouldRenderDropZone ? (
                <DropZone
                  section={section}
                  photos={sectionPhotos}
                  isInteractive={isInteractive}
                  draggableComponent={DraggablePhoto}
                  isViewerMode={!isInteractive}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <DragOverlay>
        {activePhoto ? (
          <div className="pointer-events-none origin-top-left scale-75 transform">
            <PhotoCard
              photo={activePhoto}
              isInteractive={false}
              isViewerMode={false}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

export default PhotoDragDrop;
