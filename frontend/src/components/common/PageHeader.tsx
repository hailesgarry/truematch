import React from "react";
import { ArrowLeft } from "phosphor-react";

type HeaderPosition = "sticky" | "fixed";

export interface PageHeaderProps {
  title?: React.ReactNode;
  onBack?: () => void;
  right?: React.ReactNode;
  position?: HeaderPosition; // defaults to 'sticky'
  heightClassName?: string; // defaults to h-14
  containerClassName?: string; // defaults to max-w-md mx-auto
  backIconSize?: number;
  backIcon?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  onBack,
  right,
  position = "sticky",
  heightClassName = "h-12",
  containerClassName = "max-w-md mx-auto",
  backIconSize = 24,
  backIcon,
}) => {
  const posClass =
    position === "fixed" ? "fixed inset-x-0 top-0 z-20" : "sticky top-0 z-10";

  const resolvedBackIcon = React.useMemo(() => {
    if (backIcon === undefined || backIcon === null) {
      return <ArrowLeft size={backIconSize} />;
    }
    return backIcon;
  }, [backIcon, backIconSize]);

  const showTitle = React.useMemo(() => {
    if (title === undefined || title === null) {
      return false;
    }
    if (typeof title === "string") {
      return title.trim().length > 0;
    }
    return true;
  }, [title]);

  return (
    <div className={`${posClass} bg-white`}>
      <div
        className={`${containerClassName} w-full ${heightClassName} px-4 flex items-center justify-between`}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="text-gray-900 focus:outline-none"
          >
            {resolvedBackIcon}
          </button>
        )}
        {showTitle && (
          <h1 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold text-gray-900">
            {title}
          </h1>
        )}
        {right ? (
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {right}
          </div>
        ) : (
          <div className="w-6" aria-hidden />
        )}
      </div>
    </div>
  );
};

export default PageHeader;
