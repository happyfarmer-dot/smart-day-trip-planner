import type { CategoryId, GeoFilter, POI } from '../types/planner';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function escapeOverpassRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&').trim();
}

export function buildOverpassQuery(
  geoFilter: GeoFilter,
  keyword?: string
): string {
  let areaClause = '';
  if (geoFilter.mode === 'radius') {
    // Cap radius at 12km for fast Overpass response
    const radiusMeters = Math.min(12000, Math.round(geoFilter.maxDistanceKm * 1000));
    areaClause = `(around:${radiusMeters},${geoFilter.center.lat.toFixed(5)},${geoFilter.center.lng.toFixed(5)})`;
  } else {
    // Overpass poly expects "lat1 lon1 lat2 lon2 ..."
    const polyStr = geoFilter.coordinates
      .slice(0, -1)
      .map(([lng, lat]) => `${lat.toFixed(5)} ${lng.toFixed(5)}`)
      .join(' ');
    areaClause = `(poly:"${polyStr}")`;
  }

  const trimmed = keyword?.trim() ?? '';
  const nameFilter = trimmed
    ? `[~"^(name|name:zh|name:en|cuisine|brand)$"~"${escapeOverpassRegex(trimmed)}",i]`
    : '["name"]';

  return `
[out:json][timeout:12];
(
  nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream|pub|bar|biergarten)$"]${nameFilter}${areaClause};
  nwr["shop"~"^(bakery|coffee|tea|pastry|beverages)$"]${nameFilter}${areaClause};
  nwr["tourism"~"^(attraction|museum|gallery|viewpoint)$"]${nameFilter}${areaClause};
);
out center 80;
`.trim();
}

function mapOsmTagsToPoi(el: OverpassElement, city: 'taichung' | 'taipei'): POI | null {
  const tags = el.tags;
  if (!tags || !tags.name) return null;

  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const amenity = tags.amenity ?? '';
  const shop = tags.shop ?? '';
  const tourism = tags.tourism ?? '';

  const categories: CategoryId[] = [];
  let suggestedMinutes = 60;
  let avgCostNtd = 220;
  let isIndoor = true;

  if (amenity === 'cafe' || shop === 'coffee' || shop === 'tea') {
    categories.push('cafe');
    if (amenity === 'restaurant') categories.push('food');
    suggestedMinutes = 60;
    avgCostNtd = 180;
  } else if (
    ['restaurant', 'fast_food', 'food_court', 'ice_cream', 'pub', 'bar', 'biergarten'].includes(amenity) ||
    ['bakery', 'pastry', 'beverages'].includes(shop)
  ) {
    categories.push('food');
    suggestedMinutes = amenity === 'fast_food' || shop === 'beverages' ? 45 : 70;
    avgCostNtd =
      amenity === 'fast_food' || amenity === 'ice_cream' || shop === 'bakery' || shop === 'beverages'
        ? 140
        : 320;
  } else if (tourism === 'museum' || tourism === 'gallery') {
    categories.push('art');
    suggestedMinutes = 90;
    avgCostNtd = 150;
  } else if (tourism === 'viewpoint') {
    categories.push('nature');
    suggestedMinutes = 50;
    avgCostNtd = 0;
    isIndoor = false;
  } else {
    categories.push('art');
    suggestedMinutes = 60;
    avgCostNtd = 100;
  }

  const district =
    tags['addr:district'] ||
    tags['addr:suburb'] ||
    tags['addr:street'] ||
    '地圖探索';

  const typeLabel =
    tags.cuisine
      ? `料理類型：${tags.cuisine.replace(/;/g, '、')}`
      : amenity === 'cafe'
        ? '地圖咖啡廳'
        : amenity === 'fast_food'
          ? '地圖小吃／速食'
          : amenity === 'restaurant'
            ? '地圖餐廳'
            : tourism
              ? '地圖景點'
              : '地圖美食店家';

  const streetInfo = tags['addr:street']
    ? ` · 位於 ${tags['addr:street']}${tags['addr:housenumber'] ?? ''}`
    : '';

  return {
    id: `osm-${el.type}-${el.id}`,
    city,
    district,
    name: tags.name,
    lat,
    lng,
    categories,
    suggestedMinutes,
    avgCostNtd,
    openMinutes: 480,  // 08:00 default when OSM hours unparsed
    closeMinutes: 1320, // 22:00
    closedDays: [],
    isIndoor,
    highlight: `[OSM 地圖資料庫] ${typeLabel}${streetInfo}`,
  };
}

export function parseOverpassElements(
  elements: OverpassElement[],
  city: 'taichung' | 'taipei'
): POI[] {
  const seenNames = new Set<string>();
  const results: POI[] = [];

  for (const el of elements) {
    const poi = mapOsmTagsToPoi(el, city);
    if (!poi) continue;
    const key = poi.name.trim().toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    results.push(poi);
  }

  return results;
}

export async function fetchLiveMapPois(
  geoFilter: GeoFilter,
  city: 'taichung' | 'taipei',
  keyword?: string
): Promise<POI[]> {
  const query = buildOverpassQuery(geoFilter, keyword);
  const body = `data=${encodeURIComponent(query)}`;

  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Overpass HTTP ${res.status}`);
      }
      const json = (await res.json()) as { elements?: OverpassElement[] };
      return parseOverpassElements(json.elements ?? [], city);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error('無法連線至 OpenStreetMap Overpass 地圖資料庫');
}
