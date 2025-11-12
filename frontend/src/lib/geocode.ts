import UniversalGeocoder from "universal-geocoder";
import type { LocationSelection } from "../components/common/LocationPicker";

export type Coordinates = {
  latitude: number;
  longitude: number;
};

const geocoder = UniversalGeocoder.createGeocoder({
  provider: "openstreetmap",
  userAgent: "TruematchDatingApp/1.0 (contact@truematch.app)",
  useSsl: true,
});

const cache = new Map<string, Coordinates | null>();

function buildQueryParts(value: LocationSelection): string[] {
  const parts: string[] = [];
  const city = value.cityName.trim();
  const state = value.stateName.trim() || value.stateCode.trim();
  const country = value.countryName.trim();
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (country) parts.push(country);
  return parts;
}

function makeCacheKey(value: LocationSelection): string {
  return [
    value.cityName.toLowerCase(),
    value.stateCode.toLowerCase(),
    value.stateName.toLowerCase(),
    value.countryCode.toLowerCase(),
    value.countryName.toLowerCase(),
  ].join("|");
}

export async function geocodeLocationSelection(
  value: LocationSelection
): Promise<Coordinates | null> {
  if (!value.countryCode && !value.countryName.trim()) {
    return null;
  }

  const key = makeCacheKey(value);
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  const queries: string[] = [];
  const parts = buildQueryParts(value);
  if (parts.length) {
    queries.push(parts.join(", "));
  }

  const state = value.stateName.trim() || value.stateCode.trim();
  const country = value.countryName.trim();
  if (state && country) {
    const stateCountry = [state, country].join(", ");
    if (!queries.includes(stateCountry)) queries.push(stateCountry);
  }

  if (country) {
    queries.push(country);
  }

  for (const query of queries) {
    if (!query) continue;
    try {
      const results = await geocoder.geocode(query);
      const match = Array.isArray(results) ? results[0] : undefined;
      const lat = match?.coordinates?.latitude;
      const lon = match?.coordinates?.longitude;
      if (
        typeof lat === "number" &&
        Number.isFinite(lat) &&
        typeof lon === "number" &&
        Number.isFinite(lon)
      ) {
        const coords = { latitude: lat, longitude: lon };
        cache.set(key, coords);
        return coords;
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("[geocode] failed", query, error);
      }
    }
  }

  cache.set(key, null);
  return null;
}
