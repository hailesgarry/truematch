declare module "react-swipeable" {
  export type SwipeDirection = "Left" | "Right" | "Up" | "Down";

  export interface SwipeEventData {
    deltaX: number;
    deltaY: number;
    absX: number;
    absY: number;
    velocity: number;
    dir: SwipeDirection;
    event: Event;
    initial: [number, number];
  }

  export interface SwipeableHandlers {
    [key: string]: unknown;
  }

  export interface SwipeableOptions {
    delta?: number;
    trackMouse?: boolean;
    trackTouch?: boolean;
    preventScrollOnSwipe?: boolean;
    rotationAngle?: number;
    onSwiping?: (eventData: SwipeEventData) => void;
    onSwiped?: (eventData: SwipeEventData) => void;
    onSwipedLeft?: (eventData: SwipeEventData) => void;
    onSwipedRight?: (eventData: SwipeEventData) => void;
    onSwipedUp?: (eventData: SwipeEventData) => void;
    onSwipedDown?: (eventData: SwipeEventData) => void;
  }

  export function useSwipeable(options: SwipeableOptions): SwipeableHandlers;
}
