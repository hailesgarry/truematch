import React from "react";
import { Controller } from "react-hook-form";
import type {
  Control,
  ControllerFieldState,
  ControllerRenderProps,
  FieldValues,
  Path,
} from "react-hook-form";

import Field from "../ui/Field";

export interface ValidatedFieldRenderParams<TFieldValues extends FieldValues> {
  field: ControllerRenderProps<TFieldValues>;
  fieldState: ControllerFieldState;
  inputProps: {
    id: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  };
}

export interface ValidatedFieldProps<TFieldValues extends FieldValues> {
  control: Control<TFieldValues>;
  name: Path<TFieldValues>;
  label: string;
  render: (params: ValidatedFieldRenderParams<TFieldValues>) => React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
}

const ValidatedField = <TFieldValues extends FieldValues>({
  control,
  name,
  label,
  render,
  hint,
  required,
  className,
}: ValidatedFieldProps<TFieldValues>) => {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const hasError = Boolean(fieldState.error);
        const errorMessage = fieldState.error?.message;
        const errorId = hasError ? `${name}-error` : undefined;
        const hintId = !hasError && hint ? `${name}-hint` : undefined;
        const ariaDescribedBy = errorId ?? hintId;

        return (
          <Field
            label={label}
            htmlFor={field.name}
            error={errorMessage}
            hint={!hasError ? hint : undefined}
            required={required}
            className={className}
          >
            {render({
              field,
              fieldState,
              inputProps: {
                id: field.name,
                "aria-invalid": hasError ? true : undefined,
                "aria-describedby": ariaDescribedBy,
              },
            })}
          </Field>
        );
      }}
    />
  );
};

export default ValidatedField;
