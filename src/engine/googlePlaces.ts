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
  if (t.has('historical_landmark') || t.has('cultural_landmark') || t.has('hindu_temple') || t.has('buddhist_temple') || t.has('place_of_worship')) {
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

let loadedKey = '';
let sdkPromise: Promise<void> | null = null;

function loadGoogleMapsSdk(apiKey: string): Promise<void> {
  const g = window as unknown as { google?: { maps?: { places?: unknown } } };
  if (g.google?.maps?.places && loadedKey === apiKey) {
    return Promise.resolve();
  }
  if (sdkPromise && loadedKey === apiKey) {
    return sdkPromise;
  }

  loadedKey = apiKey;
  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('gmaps-places-sdk');
    if (existing) existing.remove();

    const script = document.createElement('script');
    script.id = 'gmaps-places-sdk';
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=zh-TW`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('無法載入 Google Maps JS SDK，請檢查 API Key 或網域限制設定。'));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export async function fetchGooglePlacesPois(
  apiKey: string,
  geoFilter: GeoFilter,
  city: 'taichung' | 'taipei',
  keyword?: string
): Promise<POI[]> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey.startsWith('AIza')) {
    throw new Error(
      '金鑰格式不正確：請填入 Google Cloud Console「憑證」中以 AIza 開頭的 API 金鑰（並非 OAuth 用戶端 ID）。'
    );
  }

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

  // Use official Google Maps JS SDK PlacesService (works with standard browser API keys)
  await loadGoogleMapsSdk(trimmedKey);

  const g = window as unknown as {
    google?: {
      maps?: {
        LatLng: new (lat: number, lng: number) => unknown;
        places?: {
          PlacesService: new (attrContainer: HTMLElement) => {
            nearbySearch: (
              req: Record<string, unknown>,
              cb: (results: Array<{
                place_id?: string;
                name?: string;
                vicinity?: string;
                formatted_address?: string;
                geometry?: { location?: { lat: () => number; lng: () => number } };
                types?: string[];
                rating?: number;
                user_ratings_total?: number;
              }> | null, status: string) => void
            ) => void;
            textSearch: (
              req: Record<string, unknown>,
              cb: (results: Array<{
                place_id?: string;
                name?: string;
                vicinity?: string;
                formatted_address?: string;
                geometry?: { location?: { lat: () => number; lng: () => number } };
                types?: string[];
                rating?: number;
                user_ratings_total?: number;
              }> | null, status: string) => void
            ) => void;
          };
        };
      };
    };
  };

  if (!g.google?.maps?.places?.PlacesService) {
    throw new Error('Google Maps Places 服務尚未啟用，請確認已啟用 Places API 與 Maps JavaScript API。');
  }

  const dummyDiv = document.createElement('div');
  const service = new g.google.maps.places.PlacesService(dummyDiv);
  const location = new g.google.maps.LatLng(center.lat, center.lng);
  const trimmedQuery = keyword?.trim();

  return new Promise<POI[]>((resolve, reject) => {
    const handleResults = (
      results: Array<{
        place_id?: string;
        name?: string;
        vicinity?: string;
        formatted_address?: string;
        geometry?: { location?: { lat: () => number; lng: () => number } };
        types?: string[];
        rating?: number;
        user_ratings_total?: number;
      }> | null,
      status: string
    ) => {
      if (status === 'ZERO_RESULTS') {
        resolve([]);
        return;
      }
      if (status !== 'OK' || !results) {
        reject(new Error(`Google Maps Places 查詢失敗 (${status})，請確認金鑰已啟用 Places API 與計費功能。`));
        return;
      }

      const pois: POI[] = results
        .filter((p) => p.name && p.geometry?.location)
        .map((p) => {
          const lat = p.geometry!.location!.lat();
          const lng = p.geometry!.location!.lng();
          const mapped = mapGoogleTypesToCategories(p.types);
          const addr = p.vicinity || p.formatted_address || '';
          const ratingStr = p.rating
            ? `⭐ ${p.rating.toFixed(1)} (${p.user_ratings_total ?? 0})`
            : 'Google Maps 景點';

          return {
            id: `gmap-${p.place_id ?? p.name}`,
            city,
            district: addr.slice(0, 12) || 'Google Maps',
            name: p.name!,
            lat,
            lng,
            categories: mapped.categories,
            suggestedMinutes: mapped.suggestedMinutes,
            avgCostNtd: mapped.avgCostNtd,
            openMinutes: 480,
            closeMinutes: 1320,
            closedDays: [],
            isIndoor: mapped.isIndoor,
            highlight: `[Google Maps] ${ratingStr}${addr ? ` · ${addr}` : ''}`,
          };
        });

      resolve(pois);
    };

    if (trimmedQuery) {
      service.textSearch(
        {
          query: trimmedQuery,
          location,
          radius: radiusMeters,
        },
        handleResults
      );
    } else {
      service.nearbySearch(
        {
          location,
          radius: radiusMeters,
          type: 'tourist_attraction',
        },
        handleResults
      );
    }
  });
}
