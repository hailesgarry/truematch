import React from "react";
import clsx from "clsx";

export const fieldControlClasses =
  "w-full rounded-md border border-gray-300 px-3 py-3 text-sm text-gray-900 focus:outline-none disabled:bg-gray-100";

export interface FieldProps {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
}

const Field: React.FC<FieldProps> = ({
  label,
  htmlFor,
  children,
  hint,
  error,
  required = false,
  className,
}) => {
  const labelId = `${htmlFor}-label`;
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <label
        id={labelId}
        htmlFor={htmlFor}
        className="text-sm font-medium text-gray-900"
      >
        {label}
        {required ? <span className="ml-1 text-red-500">*</span> : null}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
};

export default Field;
