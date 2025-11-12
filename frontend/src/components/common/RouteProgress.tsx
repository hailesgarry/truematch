import React from "react";
import { useUiStore } from "../../stores/uiStore";
import NProgressBar from "./NProgressBar";

// Observes global route loading state and mirrors it to NProgress
const RouteProgress: React.FC = () => {
  const isLoading = useUiStore((state) => state.routeLoading);

  return <NProgressBar active={isLoading} showSpinner={false} />;
};

export default RouteProgress;
