import { convertDistance, getDistance } from "geolib";
import type { GeoLocation } from "../types";
import type { DistanceUnit } from "../stores/preferencesStore";

export function calculateDistanceMeters(
  a?: GeoLocation | null,
  b?: GeoLocation | null
): number | null {
  const lat1 = typeof a?.lat === "number" ? a.lat : null;
  const lon1 = typeof a?.lon === "number" ? a.lon : null;
  const lat2 = typeof b?.lat === "number" ? b.lat : null;
  const lon2 = typeof b?.lon === "number" ? b.lon : null;

  if (
    typeof lat1 !== "number" ||
    typeof lon1 !== "number" ||
    typeof lat2 !== "number" ||
    typeof lon2 !== "number"
  ) {
    return null;
  }

  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return null;
  }

  try {
    return getDistance(
      { latitude: lat1, longitude: lon1 },
      { latitude: lat2, longitude: lon2 }
    );
  } catch {
    return null;
  }
}

function roundToNearest(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

export function formatDistance(
  meters: number,
  unit: DistanceUnit = "metric"
): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return "";
  }

  if (unit === "imperial") {
    const miles = convertDistance(meters, "mi");
    if (miles >= 1) {
      const rounded =
        miles >= 10 ? Math.round(miles) : Number(miles.toFixed(1));
      return `${rounded} mi away`;
    }

    const feet = convertDistance(meters, "ft");
    const roundedFeet = Math.max(100, roundToNearest(feet, 50));
    return `${roundedFeet} ft away`;
  }

  const kilometers = convertDistance(meters, "km");
  if (kilometers >= 1) {
    const rounded =
      kilometers >= 100
        ? Math.round(kilometers)
        : Number(kilometers.toFixed(kilometers >= 10 ? 0 : 1));
    return `${rounded} km away`;
  }

  const roundedMeters = Math.max(50, roundToNearest(meters, 50));
  return `${roundedMeters} m away`;
}
