declare module "react-tinder-card" {
  import type { CSSProperties, ReactNode } from "react";
  import type { ForwardRefExoticComponent, RefAttributes } from "react";

  export type SwipeDirection = "left" | "right" | "up" | "down";

  export interface TinderCardHandle {
    swipe: (dir: SwipeDirection) => Promise<void>;
    restoreCard: () => Promise<void>;
  }

  export interface TinderCardProps {
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
    preventSwipe?: SwipeDirection[];
    flickOnSwipe?: boolean;
    swipeThreshold?: number;
    swipeRequirementType?: "velocity" | "position";
    onSwipe?: (direction: SwipeDirection) => void;
    onCardLeftScreen?: (identifier?: string) => void;
  }

  const TinderCard: ForwardRefExoticComponent<
    TinderCardProps & RefAttributes<TinderCardHandle>
  >;

  export default TinderCard;
}
