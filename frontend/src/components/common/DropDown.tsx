import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  DotsThreeVertical,
  ShareFat,
  SignOut,
  UserCircleGear,
} from "@phosphor-icons/react";
import { useUiStore } from "../../stores/uiStore";

type DropDownOffset =
  | number
  | {
      /** pushes the menu away from the trigger along the placement axis (positive grows the gap) */
      mainAxis?: number;
      /** shifts the menu perpendicular to the placement axis (positive moves right for end placements) */
      crossAxis?: number;
    };

export type DropDownItem = {
  key?: string;
  label?: string;
  icon?: React.ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
  closeOnSelect?: boolean;
  /**
   * Optional custom renderer. When provided, the item is rendered using this
   * function instead of the default button styling.
   */
  renderCustom?: (helpers: { close: () => void }) => React.ReactNode;
  onSelect?: (helpers: { close: () => void }) => void | Promise<void>;
  onHover?: () => void;
  onFocus?: () => void;
};

export type DropDownPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end";

export type DropDownProps = {
  className?: string;
  buttonClassName?: string;
  triggerIcon?: React.ReactNode;
  triggerAriaLabel?: string;
  renderTrigger?: (opts: {
    ref: React.RefObject<HTMLButtonElement | null>;
    open: boolean;
    toggle: () => void;
    disabled?: boolean;
  }) => React.ReactNode;
  disabled?: boolean;
  placement?: DropDownPlacement;
  items?: DropDownItem[];
  onLeaveRoom?: () => void;
  groupId?: string | null;
  groupName?: string | null;
  onOpenFilteredUsers?: () => void;
  offset?: DropDownOffset;
  openAnimation?:
    | "none"
    | "slide-from-top"
    | "slide-from-bottom"
    | "slide-from-left"
    | "slide-from-right";
};

const DropDown: React.FC<DropDownProps> = ({
  className,
  buttonClassName,
  triggerIcon,
  triggerAriaLabel,
  renderTrigger,
  disabled,
  placement = "bottom-end",
  items,
  onLeaveRoom,
  groupId,
  groupName,
  onOpenFilteredUsers,
  offset,
  openAnimation = "none",
}) => {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [currentPlacement, setCurrentPlacement] =
    React.useState<DropDownPlacement>(placement);
  const [menuStyles, setMenuStyles] = React.useState<React.CSSProperties>({});
  const showToast = useUiStore((s) => s.showToast);

  const closeMenu = React.useCallback(() => setOpen(false), []);

  const defaultItems: DropDownItem[] = React.useMemo(() => {
    if (!onLeaveRoom) return [];

    type IconComponent = React.ComponentType<{
      size?: number;
      weight?: React.ComponentProps<typeof ShareFat>["weight"];
      className?: string;
    }>;

    const buildItem = (
      key: string,
      label: string,
      Icon: IconComponent,
      action: () => void | Promise<void>,
      tone: "neutral" | "danger" = "neutral"
    ): DropDownItem => ({
      key,
      renderCustom: ({ close }) => {
        const handleClick = () => {
          close();
          const result = action();
          if (
            result &&
            typeof (result as Promise<unknown>).catch === "function"
          ) {
            (result as Promise<unknown>).catch(() => undefined);
          }
        };

        return (
          <div className="px-4 py-2">
            <button
              type="button"
              onClick={handleClick}
              className={`flex w-full items-center gap-2 p-0 text-left text-sm font-medium focus:outline-none ${
                tone === "danger" ? "text-red-600" : "text-gray-900"
              }`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 shrink-0">
                <Icon size={20} weight="fill" />
              </span>
              <span>{label}</span>
            </button>
          </div>
        );
      },
    });

    const shareItem = buildItem("share", "Share", ShareFat, async () => {
      if (!groupId) {
        showToast("Select a room first", 1800);
        return;
      }

      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const url = new URL(`/chat/${groupId}`, origin || "http://localhost");
      url.searchParams.set("gid", groupId);
      if (groupName) url.searchParams.set("gname", groupName);
      const link = url.toString();
      const titleText = groupName
        ? `${groupName} · Funly Chat`
        : "Funly Chat Room";

      try {
        if (typeof navigator !== "undefined" && (navigator as any).share) {
          await (navigator as any).share({
            title: titleText,
            url: link,
          });
          return;
        }
      } catch {
        // fall back to clipboard
      }

      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(link);
          copied = true;
        }
      } catch {}

      if (!copied) {
        try {
          const el = document.createElement("textarea");
          el.value = link;
          el.style.position = "fixed";
          el.style.left = "-9999px";
          document.body.appendChild(el);
          el.select();
          document.execCommand("copy");
          document.body.removeChild(el);
          copied = true;
        } catch {}
      }

      showToast(
        copied ? "Link copied to clipboard" : "Could not share link",
        1800
      );
    });

    const filteredUsersItem = buildItem(
      "filtered-users",
      "Manage muted users",
      UserCircleGear,
      () => {
        if (!groupId) {
          showToast("Select a room first", 1800);
          return;
        }
        if (typeof onOpenFilteredUsers === "function") {
          onOpenFilteredUsers();
        } else {
          showToast("Muted users overlay unavailable here", 1800);
        }
      }
    );

    const leaveItem = buildItem(
      "leave",
      "Leave room",
      SignOut,
      () => {
        onLeaveRoom?.();
      },
      "danger"
    );

    return [shareItem, filteredUsersItem, leaveItem];
  }, [groupId, groupName, onLeaveRoom, onOpenFilteredUsers, showToast]);

  const finalItems = items && items.length > 0 ? items : defaultItems;

  const updatePlacement = React.useCallback(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    const anchorEl = triggerRef.current ?? wrapperRef.current;
    const menuEl = menuRef.current;
    if (!anchorEl || !menuEl) return;

    const anchorRect = anchorEl.getBoundingClientRect();
    const menuRect = menuEl.getBoundingClientRect();

    const prefersBottom = placement.startsWith("bottom");
    const prefersEnd = placement.endsWith("end");

    let vertical: "bottom" | "top" = prefersBottom ? "bottom" : "top";
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    if (spaceBelow < menuRect.height && spaceAbove > spaceBelow) {
      vertical = "top";
    } else if (spaceAbove < menuRect.height && spaceBelow >= spaceAbove) {
      vertical = "bottom";
    }

    let horizontal: "end" | "start" = prefersEnd ? "end" : "start";
    const spaceRight = window.innerWidth - anchorRect.right;
    const spaceLeft = anchorRect.left;
    if (
      horizontal === "end" &&
      spaceRight < menuRect.width &&
      spaceLeft > spaceRight
    ) {
      horizontal = "start";
    } else if (
      horizontal === "start" &&
      spaceLeft < menuRect.width &&
      spaceRight >= spaceLeft
    ) {
      horizontal = "end";
    }

    let top =
      vertical === "bottom"
        ? anchorRect.bottom
        : anchorRect.top - menuRect.height;
    let left =
      horizontal === "start"
        ? anchorRect.left
        : anchorRect.right - menuRect.width;

    const resolvedOffset =
      typeof offset === "number"
        ? { mainAxis: offset, crossAxis: 0 }
        : offset ?? { mainAxis: 0, crossAxis: 0 };

    const mainAxisOffset = resolvedOffset.mainAxis ?? 0;
    const crossAxisOffset = resolvedOffset.crossAxis ?? 0;

    if (mainAxisOffset) {
      top += vertical === "bottom" ? mainAxisOffset : -mainAxisOffset;
    }

    if (crossAxisOffset) {
      left += horizontal === "end" ? crossAxisOffset : -crossAxisOffset;
    }

    const viewportPadding = 8;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const maxHeightValue = `calc(100vh - ${viewportPadding * 2}px)`;
    const maxWidthValue = `calc(100vw - ${viewportPadding * 2}px)`;

    const maxTop = viewportHeight - menuRect.height - viewportPadding;
    const maxLeft = viewportWidth - menuRect.width - viewportPadding;

    if (top < viewportPadding) {
      top = viewportPadding;
      vertical = "top";
    } else if (top > maxTop) {
      top = Math.max(viewportPadding, maxTop);
      vertical = "bottom";
    }

    if (left < viewportPadding) {
      left = viewportPadding;
      horizontal = "start";
    } else if (left > maxLeft) {
      left = Math.max(viewportPadding, maxLeft);
      horizontal = "end";
    }

    const nextPlacement = `${vertical}-${horizontal}` as DropDownPlacement;
    setCurrentPlacement((prev) =>
      prev === nextPlacement ? prev : nextPlacement
    );

    setMenuStyles((prev) => {
      if (
        prev.top === top &&
        prev.left === left &&
        prev.maxHeight === maxHeightValue &&
        prev.maxWidth === maxWidthValue &&
        prev.overflowY === "auto"
      ) {
        return prev;
      }

      return {
        position: "fixed",
        top,
        left,
        maxHeight: maxHeightValue,
        maxWidth: maxWidthValue,
        overflowY: "auto",
      } satisfies React.CSSProperties;
    });
  }, [open, placement, offset]);

  React.useEffect(() => {
    if (!open) {
      setMenuStyles({});
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    const handle = () => updatePlacement();
    window.addEventListener("resize", handle);
    window.addEventListener("scroll", handle, true);

    return () => {
      window.removeEventListener("resize", handle);
      window.removeEventListener("scroll", handle, true);
    };
  }, [open, updatePlacement]);

  React.useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      closeMenu();
    };

    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, closeMenu]);

  const menuMotion = React.useMemo(() => {
    switch (openAnimation) {
      case "slide-from-top":
        return {
          initial: { opacity: 0, y: -12 },
          animate: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
          },
          exit: {
            opacity: 0,
            y: -12,
            transition: { duration: 0.14, ease: [0.4, 0, 0.2, 1] },
          },
        } as const;
      case "slide-from-bottom":
        return {
          initial: { opacity: 0, y: 12 },
          animate: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
          },
          exit: {
            opacity: 0,
            y: 12,
            transition: { duration: 0.14, ease: [0.4, 0, 0.2, 1] },
          },
        } as const;
      case "slide-from-left":
        return {
          initial: { opacity: 0, x: -12 },
          animate: {
            opacity: 1,
            x: 0,
            transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
          },
          exit: {
            opacity: 0,
            x: -12,
            transition: { duration: 0.14, ease: [0.4, 0, 0.2, 1] },
          },
        } as const;
      case "slide-from-right":
        return {
          initial: { opacity: 0, x: 12 },
          animate: {
            opacity: 1,
            x: 0,
            transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
          },
          exit: {
            opacity: 0,
            x: 12,
            transition: { duration: 0.14, ease: [0.4, 0, 0.2, 1] },
          },
        } as const;
      default:
        return {
          initial: { opacity: 1, scale: 1 },
          animate: {
            opacity: 1,
            scale: 1,
            transition: { duration: 0 },
          },
          exit: {
            opacity: 1,
            scale: 1,
            transition: { duration: 0 },
          },
        } as const;
    }
  }, [openAnimation]);

  React.useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    const { ResizeObserver } = window as typeof window & {
      ResizeObserver?: typeof window.ResizeObserver;
    };
    if (typeof ResizeObserver !== "function") return;

    const menuEl = menuRef.current;
    if (!menuEl) return;

    const observer = new ResizeObserver(() => updatePlacement());
    observer.observe(menuEl);

    return () => observer.disconnect();
  }, [open, updatePlacement]);

  React.useEffect(() => {
    if (!open) {
      setCurrentPlacement(placement);
    }
  }, [open, placement]);

  React.useLayoutEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    updatePlacement();

    const raf = window.requestAnimationFrame(() => updatePlacement());
    return () => window.cancelAnimationFrame(raf);
  }, [open, updatePlacement, currentPlacement]);

  React.useEffect(() => {
    if (!open) return;

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!wrapperRef.current || !target) return;
      if (!wrapperRef.current.contains(target)) {
        closeMenu();
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, closeMenu]);

  React.useEffect(() => {
    if (!open) return;
    const firstItem = wrapperRef.current?.querySelector<HTMLButtonElement>(
      "[data-room-menu-item]"
    );
    firstItem?.focus();
  }, [open]);

  const handleToggle = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
  };

  return (
    <div
      ref={wrapperRef}
      className={`relative inline-flex ${className ? className : ""}`.trim()}
    >
      {renderTrigger ? (
        renderTrigger({ ref: triggerRef, open, toggle: handleToggle, disabled })
      ) : (
        <button
          type="button"
          ref={triggerRef}
          onClick={handleToggle}
          disabled={disabled}
          className={`focus:outline-none ${buttonClassName || "text-white"} ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`.trim()}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={triggerAriaLabel || "Room options"}
        >
          {triggerIcon || <DotsThreeVertical size={24} weight="bold" />}
        </button>
      )}

      <AnimatePresence>
        {open && finalItems.length > 0 && (
          <motion.div
            key="dropdown-menu"
            ref={menuRef}
            initial={menuMotion.initial}
            animate={menuMotion.animate}
            exit={menuMotion.exit}
            className={`fixed z-50 min-w-[200px] rounded-lg border border-gray-100 bg-white shadow-lg py-1 ${
              openAnimation === "slide-from-top"
                ? "origin-top will-change-transform"
                : openAnimation === "slide-from-bottom"
                ? "origin-bottom will-change-transform"
                : openAnimation === "slide-from-left"
                ? "origin-left will-change-transform"
                : openAnimation === "slide-from-right"
                ? "origin-right will-change-transform"
                : ""
            }`.trim()}
            style={menuStyles}
            role="menu"
            aria-label="Menu"
            data-placement={currentPlacement}
          >
            {finalItems.map((item, index) => {
              const {
                key,
                label,
                icon,
                tone,
                disabled: itemDisabled,
                closeOnSelect,
                renderCustom,
                onSelect,
                onHover,
                onFocus,
              } = item;

              if (renderCustom) {
                return (
                  <div
                    key={key ?? index}
                    data-room-menu-item={index === 0 ? "true" : undefined}
                  >
                    {renderCustom({ close: closeMenu })}
                  </div>
                );
              }

              const handleClick = () => {
                if (itemDisabled) return;
                const maybePromise = onSelect?.({ close: closeMenu });
                if (closeOnSelect === false) {
                  return;
                }
                if (
                  maybePromise &&
                  typeof (maybePromise as any).finally === "function"
                ) {
                  (maybePromise as Promise<unknown>).finally(closeMenu);
                } else if (!onSelect) {
                  closeMenu();
                }
              };

              const baseClasses =
                "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm rounded-md";
              const toneClass =
                tone === "danger" ? "text-red-600" : "text-gray-900";
              const disabledClass = itemDisabled
                ? "opacity-50 cursor-not-allowed"
                : "";

              return (
                <button
                  key={key ?? index}
                  type="button"
                  role="menuitem"
                  data-room-menu-item={index === 0 ? "true" : undefined}
                  className={`${baseClasses} ${toneClass} ${disabledClass}`.trim()}
                  onClick={handleClick}
                  onMouseEnter={onHover}
                  onFocus={onFocus}
                  disabled={itemDisabled}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DropDown;
