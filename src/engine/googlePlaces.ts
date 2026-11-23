import * as turf from '@turf/turf';
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

/**
 * 精準從台灣地址中萃取出「區 / 鄉 / 鎮 / 市」名稱，避免郵遞區號殘留或斷字
 */
export function extractTaiwanDistrict(address?: string): string {
  if (!address) return '精選地點';
  // Match e.g. 407台灣臺中市西屯區... -> 西屯區, 505彰化縣鹿港鎮... -> 鹿港鎮
  const withCity = address.match(
    /(?:臺|台)?[\u4e00-\u9fa5]{1,2}[市縣]([\u4e00-\u9fa5]{1,3}?[區鄉鎮市])/
  );
  if (withCity?.[1]) return withCity[1];

  const standalone = address.match(/([\u4e00-\u9fa5]{1,3}?[區鄉鎮])/);
  if (standalone?.[1]) return standalone[1];

  const cityOnly = address.match(/((?:臺|台)?[\u4e00-\u9fa5]{1,2}[市縣])/);
  if (cityOnly?.[1]) return cityOnly[1];

  return '精選地點';
}

function isLikelyTaiwanLand(lat: number, lng: number): boolean {
  if (lat < 21.88 || lat > 25.32 || lng < 120.02 || lng > 122.02) return false;
  // Exclude western Taiwan Strait open water
  if (lng < 120.14 && lat > 23.4 && lat < 25.1) return false;
  return true;
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

  if (
    t.has('park') ||
    t.has('national_park') ||
    t.has('hiking_area') ||
    t.has('natural_feature')
  ) {
    categories.push('nature');
    isIndoor = false;
    suggestedMinutes = 80;
    avgCostNtd = 0;
  }
  if (
    t.has('museum') ||
    t.has('art_gallery') ||
    t.has('performing_arts_theater')
  ) {
    categories.push('art');
    isIndoor = true;
    suggestedMinutes = 90;
    avgCostNtd = 150;
  }
  if (
    t.has('historical_landmark') ||
    t.has('cultural_landmark') ||
    t.has('hindu_temple') ||
    t.has('buddhist_temple') ||
    t.has('place_of_worship')
  ) {
    categories.push('heritage');
    isIndoor = false;
    suggestedMinutes = 70;
    avgCostNtd = 0;
  }
  if (
    t.has('amusement_park') ||
    t.has('zoo') ||
    t.has('aquarium') ||
    t.has('playground')
  ) {
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
  if (
    t.has('restaurant') ||
    t.has('food') ||
    t.has('bakery') ||
    t.has('night_market')
  ) {
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=zh-TW&v=weekly`;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('無法載入 Google Maps JS SDK，請檢查 API Key 或網域限制設定。'));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export function buildRingSampleCenters(
  center: { lat: number; lng: number },
  maxDistanceKm: number
): Array<{ lat: number; lng: number }> {
  if (maxDistanceKm <= 25) return [center];
  const ringRadius = maxDistanceKm * 0.75;
  const bearings = [0, 60, 120, 180, 240, 300];
  const origin = turf.point([center.lng, center.lat]);

  const sampled: Array<{ lat: number; lng: number }> = [];
  for (const b of bearings) {
    const dest = turf.destination(origin, ringRadius, b, { units: 'kilometers' });
    const [lng, lat] = dest.geometry.coordinates;
    if (isLikelyTaiwanLand(lat, lng)) {
      sampled.push({ lat, lng });
    }
  }
  return sampled.length > 0 ? sampled : [center];
}

export async function fetchGooglePlacesPois(
  apiKey: string,
  geoFilter: GeoFilter,
  _city: 'taichung' | 'taipei',
  keyword?: string
): Promise<POI[]> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey.startsWith('AIza')) {
    throw new Error(
      '金鑰格式不正確：請填入 Google Cloud Console「憑證」中以 AIza 開頭的 API 金鑰。'
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

  const maxDistKm = geoFilter.mode === 'radius' ? geoFilter.maxDistanceKm : 8;
  const intraKm = geoFilter.mode === 'radius' ? geoFilter.intraZoneDistanceKm : 8;
  const sampleCenters =
    geoFilter.mode === 'radius' && !keyword?.trim()
      ? buildRingSampleCenters(center, maxDistKm)
      : [center];
  const sampleRadiusMeters =
    maxDistKm > 25 && !keyword?.trim()
      ? Math.min(20000, Math.max(10000, Math.round(intraKm * 1200)))
      : Math.min(25000, Math.round(maxDistKm * 1000));

  await loadGoogleMapsSdk(trimmedKey);

  const g = window as unknown as {
    google?: {
      maps?: {
        LatLng: new (lat: number, lng: number) => unknown;
        importLibrary?: (lib: string) => Promise<{
          Place?: {
            searchNearby?: (req: Record<string, unknown>) => Promise<{
              places: Array<{
                id: string;
                displayName?: string;
                formattedAddress?: string;
                location?: { lat: () => number; lng: () => number };
                types?: string[];
                rating?: number;
                userRatingCount?: number;
              }>;
            }>;
            searchByText?: (req: Record<string, unknown>) => Promise<{
              places: Array<{
                id: string;
                displayName?: string;
                formattedAddress?: string;
                location?: { lat: () => number; lng: () => number };
                types?: string[];
                rating?: number;
                userRatingCount?: number;
              }>;
            }>;
          };
        }>;
        places?: {
          Place?: {
            searchNearby?: (req: Record<string, unknown>) => Promise<{
              places: Array<{
                id: string;
                displayName?: string;
                formattedAddress?: string;
                location?: { lat: () => number; lng: () => number };
                types?: string[];
                rating?: number;
                userRatingCount?: number;
              }>;
            }>;
            searchByText?: (req: Record<string, unknown>) => Promise<{
              places: Array<{
                id: string;
                displayName?: string;
                formattedAddress?: string;
                location?: { lat: () => number; lng: () => number };
                types?: string[];
                rating?: number;
                userRatingCount?: number;
              }>;
            }>;
          };
          PlacesService: new (attrContainer: HTMLElement) => {
            nearbySearch: (
              req: Record<string, unknown>,
              cb: (
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
              ) => void
            ) => void;
            textSearch: (
              req: Record<string, unknown>,
              cb: (
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
              ) => void
            ) => void;
          };
        };
      };
    };
  };

  const trimmedQuery = keyword?.trim();

  // 1. Try New Places JS API (Place.searchNearby / Place.searchByText)
  try {
    const placesLib = g.google?.maps?.importLibrary
      ? await g.google.maps.importLibrary('places')
      : g.google?.maps?.places;

    const PlaceClass = placesLib?.Place ?? g.google?.maps?.places?.Place;
    if (PlaceClass?.searchNearby && PlaceClass?.searchByText) {
      const fields = [
        'id',
        'displayName',
        'formattedAddress',
        'location',
        'types',
        'rating',
        'userRatingCount',
      ];

      const allRaw: Array<{
        id: string;
        displayName?: string;
        formattedAddress?: string;
        location?: { lat: () => number; lng: () => number };
        types?: string[];
        rating?: number;
        userRatingCount?: number;
      }> = [];

      if (trimmedQuery) {
        const res = await PlaceClass.searchByText({
          textQuery: trimmedQuery,
          fields,
          locationBias: {
            center: { lat: center.lat, lng: center.lng },
            radius: Math.min(50000, Math.round(maxDistKm * 1000)),
          },
          maxResultCount: 20,
          language: 'zh-TW',
        });
        allRaw.push(...(res.places ?? []));
      } else {
        const responses = await Promise.allSettled(
          sampleCenters.map((sc) =>
            PlaceClass.searchNearby!({
              fields,
              locationRestriction: {
                center: { lat: sc.lat, lng: sc.lng },
                radius: sampleRadiusMeters,
              },
              includedPrimaryTypes: [
                'tourist_attraction',
                'museum',
                'park',
                'restaurant',
                'cafe',
                'shopping_mall',
                'historical_landmark',
              ],
              maxResultCount: 15,
              language: 'zh-TW',
            })
          )
        );
        for (const r of responses) {
          if (r.status === 'fulfilled') {
            allRaw.push(...(r.value.places ?? []));
          }
        }
      }

      const seen = new Set<string>();
      const pois: POI[] = [];
      for (const p of allRaw) {
        if (!p.displayName || !p.location || seen.has(p.id)) continue;
        seen.add(p.id);
        const mapped = mapGoogleTypesToCategories(p.types);
        const cleanAddress = p.formattedAddress?.replace(/^\d{3,6}\s*(?:台灣|臺灣)?/, '').trim();
        pois.push({
          id: `gmap-${p.id}`,
          placeId: p.id,
          city: 'live',
          district: extractTaiwanDistrict(p.formattedAddress),
          name: p.displayName,
          lat: p.location.lat(),
          lng: p.location.lng(),
          categories: mapped.categories,
          suggestedMinutes: mapped.suggestedMinutes,
          avgCostNtd: mapped.avgCostNtd,
          openMinutes: 480,
          closeMinutes: 1320,
          closedDays: [],
          isIndoor: mapped.isIndoor,
          rating: p.rating,
          reviewCount: p.userRatingCount,
          highlight: cleanAddress || 'Google Maps 精選熱門地點',
        });
      }
      return pois;
    }
  } catch {
    // Fall through to legacy PlacesService
  }

  // 2. Fallback to classic PlacesService
  if (!g.google?.maps?.places?.PlacesService) {
    throw new Error(
      'Google Maps Places 服務尚未啟用，請確認已啟用 Places API (New) 與 Maps JavaScript API。'
    );
  }

  const dummyDiv = document.createElement('div');
  const service = new g.google.maps.places.PlacesService(dummyDiv);
  const location = new g.google.maps.LatLng(center.lat, center.lng);

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
        reject(
          new Error(
            `Google Maps Places 查詢失敗 (${status})，請確認金鑰網域限制與計費設定。`
          )
        );
        return;
      }

      const pois: POI[] = results
        .filter((p) => p.name && p.geometry?.location)
        .map((p) => {
          const lat = p.geometry!.location!.lat();
          const lng = p.geometry!.location!.lng();
          const mapped = mapGoogleTypesToCategories(p.types);
          const rawAddr = p.formatted_address || p.vicinity || '';
          const cleanAddr = rawAddr.replace(/^\d{3,6}\s*(?:台灣|臺灣)?/, '').trim();

          return {
            id: `gmap-${p.place_id ?? p.name}`,
            placeId: p.place_id,
            city: 'live',
            district: extractTaiwanDistrict(rawAddr),
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
            rating: p.rating,
            reviewCount: p.user_ratings_total,
            highlight: cleanAddr || 'Google Maps 精選熱門地點',
          };
        });

      resolve(pois);
    };

    if (trimmedQuery) {
      service.textSearch(
        { query: trimmedQuery, location, radius: sampleRadiusMeters },
        handleResults
      );
    } else {
      service.nearbySearch(
        { location, radius: sampleRadiusMeters, type: 'tourist_attraction' },
        handleResults
      );
    }
  });
}
