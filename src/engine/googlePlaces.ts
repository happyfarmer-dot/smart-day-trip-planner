import type { CategoryId, GeoFilter, POI } from '../types/planner';

const GMAPS_KEY_STORAGE = 'smart_trip_gmaps_api_key';

export function getSavedGoogleMapsApiKey(): string {
  try {
    return localStorage.getItem(GMAPS_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveGoogleMapsApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) localStorage.setItem(GMAPS_KEY_STORAGE, trimmed);
    else localStorage.removeItem(GMAPS_KEY_STORAGE);
  } catch {
    // ignore storage errors
  }
}

interface GooglePlaceV1 {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
}

function mapGoogleTypesToCategories(types: string[] = []): {
  categories: CategoryId[];
  isIndoor: boolean;
  suggestedMinutes: number;
  avgCostNtd: number;
} {
  const t = new Set(types);
  const categories: CategoryId[] = [];
  let isIndoor = true;
  let suggestedMinutes = 75;
  let avgCostNtd = 150;

  if (t.has('park') || t.has('national_park') || t.has('hiking_area') || t.has('natural_feature')) {
    categories.push('nature');
    isIndoor = false;
    suggestedMinutes = 80;
    avgCostNtd = 0;
  }
  if (t.has('museum') || t.has('art_gallery') || t.has('performing_arts_theater')) {
    categories.push('art');
    isIndoor = true;
    suggestedMinutes = 90;
    avgCostNtd = 150;
  }
  if (t.has('historical_landmark') || t.has('cultural_landmark') || t.has('hindu_temple') || t.has('buddhist_temple')) {
    categories.push('heritage');
    isIndoor = false;
    suggestedMinutes = 70;
    avgCostNtd = 0;
  }
  if (t.has('amusement_park') || t.has('zoo') || t.has('aquarium') || t.has('playground')) {
    categories.push('family');
    isIndoor = false;
    suggestedMinutes = 110;
    avgCostNtd = 300;
  }
  if (t.has('shopping_mall') || t.has('department_store') || t.has('market')) {
    categories.push('shop');
    isIndoor = true;
    suggestedMinutes = 90;
    avgCostNtd = 300;
  }
  if (t.has('cafe') || t.has('coffee_shop')) {
    categories.push('cafe');
    isIndoor = true;
    suggestedMinutes = 60;
    avgCostNtd = 200;
  }
  if (t.has('restaurant') || t.has('food') || t.has('bakery') || t.has('night_market')) {
    categories.push('food');
    isIndoor = true;
    suggestedMinutes = 70;
    avgCostNtd = 300;
  }
  if (categories.length === 0) {
    categories.push('art');
    if (t.has('tourist_attraction')) {
      isIndoor = false;
      avgCostNtd = 50;
    }
  }

  return { categories, isIndoor, suggestedMinutes, avgCostNtd };
}

export async function fetchGooglePlacesPois(
  apiKey: string,
  geoFilter: GeoFilter,
  city: 'taichung' | 'taipei',
  keyword?: string
): Promise<POI[]> {
  const center =
    geoFilter.mode === 'radius'
      ? geoFilter.center
      : (() => {
          const coords = geoFilter.coordinates;
          const sum = coords.reduce(
            (acc, [lng, lat]) => ({ lat: acc.lat + lat, lng: acc.lng + lng }),
            { lat: 0, lng: 0 }
          );
          return {
            lat: sum.lat / Math.max(1, coords.length),
            lng: sum.lng / Math.max(1, coords.length),
          };
        })();

  const radiusMeters =
    geoFilter.mode === 'radius'
      ? Math.min(25000, Math.round(geoFilter.maxDistanceKm * 1000))
      : 8000;

  const trimmed = keyword?.trim();
  const fieldMask =
    'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount';

  const url = trimmed
    ? 'https://places.googleapis.com/v1/places:searchText'
    : 'https://places.googleapis.com/v1/places:searchNearby';

  const body = trimmed
    ? {
        textQuery: trimmed,
        languageCode: 'zh-TW',
        maxResultCount: 20,
        locationBias: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius: radiusMeters,
          },
        },
      }
    : {
        includedTypes: [
          'tourist_attraction',
          'museum',
          'park',
          'restaurant',
          'cafe',
          'shopping_mall',
          'historical_landmark',
        ],
        languageCode: 'zh-TW',
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius: radiusMeters,
          },
        },
      };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey.trim(),
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Places API 錯誤 (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as { places?: GooglePlaceV1[] };
  const places = json.places ?? [];

  return places
    .filter((p) => p.displayName?.text && p.location)
    .map((p) => {
      const mapped = mapGoogleTypesToCategories(p.types);
      const ratingStr = p.rating
        ? `⭐ ${p.rating.toFixed(1)} (${p.userRatingCount ?? 0} 則評論)`
        : 'Google Maps 景點';
      return {
        id: `gmap-${p.id}`,
        city,
        district: p.formattedAddress?.slice(0, 14) || 'Google Maps',
        name: p.displayName!.text,
        lat: p.location!.latitude,
        lng: p.location!.longitude,
        categories: mapped.categories,
        suggestedMinutes: mapped.suggestedMinutes,
        avgCostNtd: mapped.avgCostNtd,
        openMinutes: 480,
        closeMinutes: 1320,
        closedDays: [],
        isIndoor: mapped.isIndoor,
        highlight: `[Google Maps] ${ratingStr}${p.formattedAddress ? ` · ${p.formattedAddress}` : ''}`,
      };
    });
}
