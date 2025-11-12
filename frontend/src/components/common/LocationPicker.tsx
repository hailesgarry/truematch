import React, { useId, useMemo } from "react";
import { CaretDown } from "phosphor-react";
import {
  City,
  Country,
  State,
  type ICity,
  type ICountry,
  type IState,
} from "country-state-city";
import Field, { fieldControlClasses } from "../ui/Field";

export interface LocationSelection {
  countryCode: string;
  countryName: string;
  stateCode: string;
  stateName: string;
  cityName: string;
}

export function createEmptyLocationSelection(): LocationSelection {
  return {
    countryCode: "",
    countryName: "",
    stateCode: "",
    stateName: "",
    cityName: "",
  };
}

interface LocationPickerProps {
  value: LocationSelection;
  onChange: (value: LocationSelection) => void;
  className?: string;
  hideState?: boolean;
  hideCity?: boolean;
  countryLabel?: string;
  countryPlaceholder?: string;
  countryRequired?: boolean;
  renderCountryField?: (props: {
    id: string;
    value: LocationSelection;
    onSelect: (country: ICountry | null) => void;
    placeholder: string;
    disabled: boolean;
    required: boolean;
  }) => React.ReactNode;
  stateRequired?: boolean;
  cityRequired?: boolean;
  statePlaceholder?: string;
  renderStateField?: (props: {
    id: string;
    value: LocationSelection;
    onSelect: (state: IState | null) => void;
    placeholder: string;
    disabled: boolean;
    required: boolean;
    states: IState[];
  }) => React.ReactNode;
}

const LocationPicker: React.FC<LocationPickerProps> = ({
  value,
  onChange,
  className,
  hideState = false,
  hideCity = false,
  countryLabel = "Country",
  countryPlaceholder = "Select a country",
  countryRequired = false,
  renderCountryField,
  statePlaceholder = "Select a state",
  stateRequired = false,
  cityRequired = false,
  renderStateField,
}) => {
  const countryId = useId();
  const stateId = useId();
  const cityId = useId();
  const cityListId = useId();

  const countries = useMemo<ICountry[]>(() => Country.getAllCountries(), []);
  const states = useMemo(
    () =>
      !hideState && value.countryCode
        ? State.getStatesOfCountry(value.countryCode)
        : [],
    [hideState, value.countryCode]
  ) as IState[];
  const cities = useMemo(() => {
    if (hideCity || !value.countryCode) return [] as ICity[];
    if (value.stateCode) {
      return City.getCitiesOfState(
        value.countryCode,
        value.stateCode
      ) as ICity[];
    }
    return City.getCitiesOfCountry(value.countryCode) as ICity[];
  }, [hideCity, value.countryCode, value.stateCode]);

  const handleCountrySelect = (country: ICountry | null) => {
    if (!country) {
      onChange(createEmptyLocationSelection());
      return;
    }
    onChange({
      countryCode: country.isoCode,
      countryName: country.name,
      stateCode: "",
      stateName: "",
      cityName: "",
    });
  };

  const handleCountryChange: React.ChangeEventHandler<HTMLSelectElement> = (
    event
  ) => {
    const isoCode = event.target.value;
    if (!isoCode) {
      onChange(createEmptyLocationSelection());
      return;
    }
    const country = countries.find((c) => c.isoCode === isoCode);
    onChange({
      countryCode: isoCode,
      countryName: country?.name ?? "",
      stateCode: "",
      stateName: "",
      cityName: "",
    });
  };

  const handleStateChange: React.ChangeEventHandler<HTMLSelectElement> = (
    event
  ) => {
    const isoCode = event.target.value;
    const state = isoCode
      ? states.find((s) => s.isoCode === isoCode)
      : undefined;
    onChange({
      countryCode: value.countryCode,
      countryName: value.countryName,
      stateCode: isoCode || "",
      stateName: state?.name ?? "",
      cityName: value.cityName,
    });
  };

  const handleStateSelect = (state: IState | null) => {
    onChange({
      countryCode: value.countryCode,
      countryName: value.countryName,
      stateCode: state?.isoCode ?? "",
      stateName: state?.name ?? "",
      cityName: value.cityName,
    });
  };

  const handleStateInput: React.ChangeEventHandler<HTMLInputElement> = (
    event
  ) => {
    const name = event.target.value;
    onChange({
      countryCode: value.countryCode,
      countryName: value.countryName,
      stateCode: "",
      stateName: name,
      cityName: value.cityName,
    });
  };

  const handleCityInput: React.ChangeEventHandler<HTMLInputElement> = (
    event
  ) => {
    onChange({
      countryCode: value.countryCode,
      countryName: value.countryName,
      stateCode: value.stateCode,
      stateName: value.stateName,
      cityName: event.target.value,
    });
  };

  const hasStates = !hideState && states.length > 0;

  return (
    <div className={["space-y-6", className].filter(Boolean).join(" ")}>
      <Field
        label={countryLabel}
        htmlFor={countryId}
        required={countryRequired}
      >
        {renderCountryField ? (
          renderCountryField({
            id: countryId,
            value,
            onSelect: handleCountrySelect,
            placeholder: countryPlaceholder,
            disabled: false,
            required: countryRequired,
          })
        ) : (
          <div className="relative">
            <select
              id={countryId}
              className={`${fieldControlClasses} appearance-none pr-10 bg-white text-gray-900`}
              value={value.countryCode}
              onChange={handleCountryChange}
              required={countryRequired}
              style={
                value.countryCode
                  ? { color: "#111827", fontStyle: "normal" }
                  : { color: "#9ca3af", fontStyle: "italic" }
              }
            >
              <option
                value=""
                disabled
                style={{ color: "#9ca3af", fontStyle: "italic" }}
              >
                {countryPlaceholder}
              </option>
              {countries.map((country) => (
                <option
                  key={country.isoCode}
                  value={country.isoCode}
                  style={{ color: "#111827", fontStyle: "normal" }}
                >
                  {country.name}
                </option>
              ))}
            </select>
            <CaretDown
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
          </div>
        )}
      </Field>

      {!hideState ? (
        <Field
          label="State / Province"
          htmlFor={stateId}
          required={stateRequired}
        >
          {hasStates ? (
            renderStateField ? (
              renderStateField({
                id: stateId,
                value,
                onSelect: handleStateSelect,
                placeholder: statePlaceholder,
                disabled: !value.countryCode,
                required: stateRequired,
                states,
              })
            ) : (
              <div className="relative">
                <select
                  id={stateId}
                  className={`${fieldControlClasses} appearance-none pr-10 bg-white`}
                  value={value.stateCode}
                  onChange={handleStateChange}
                  disabled={!value.countryCode}
                  required={stateRequired}
                >
                  <option value="">{statePlaceholder}</option>
                  {states.map((state) => (
                    <option key={state.isoCode} value={state.isoCode}>
                      {state.name}
                    </option>
                  ))}
                </select>
                <CaretDown
                  size={16}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  aria-hidden
                />
              </div>
            )
          ) : (
            <input
              id={stateId}
              type="text"
              className={fieldControlClasses}
              placeholder="Enter state / province"
              value={value.stateName}
              onChange={handleStateInput}
              disabled={!value.countryCode}
              required={stateRequired}
            />
          )}
        </Field>
      ) : null}

      {!hideCity ? (
        <Field label="City" htmlFor={cityId} required={cityRequired}>
          <input
            id={cityId}
            list={cities.length ? cityListId : undefined}
            type="text"
            className={fieldControlClasses}
            placeholder="Enter city"
            value={value.cityName}
            onChange={handleCityInput}
            disabled={!value.countryCode}
            required={cityRequired}
          />
          {cities.length > 0 && (
            <datalist id={cityListId}>
              {cities.map((city) => (
                <option
                  key={`${city.name}-${city.latitude}-${city.longitude}`}
                  value={city.name}
                />
              ))}
            </datalist>
          )}
        </Field>
      ) : null}
    </div>
  );
};

export default LocationPicker;
