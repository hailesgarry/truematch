import type { ReactNode } from "react";

declare module "react" {
  interface SuspenseProps {
    hydrateFallback?: ReactNode;
  }
}
