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
    const radiusMeters = Math.min(45000, Math.round(geoFilter.maxDistanceKm * 1000));
    areaClause = `(around:${radiusMeters},${geoFilter.center.lat.toFixed(5)},${geoFilter.center.lng.toFixed(5)})`;
  } else {
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
[out:json][timeout:14];
(
  nwr["tourism"~"^(attraction|museum|gallery|viewpoint|theme_park|zoo|aquarium|artwork|picnic_site)$"]${nameFilter}${areaClause};
  nwr["historic"~"^(monument|memorial|castle|temple|ruins|heritage|archaeological_site|building)$"]${nameFilter}${areaClause};
  nwr["leisure"~"^(park|garden|nature_reserve|water_park)$"]${nameFilter}${areaClause};
  nwr["amenity"~"^(place_of_worship|arts_centre|theatre|marketplace|restaurant|cafe|fast_food|food_court|ice_cream)$"]${nameFilter}${areaClause};
  nwr["shop"~"^(mall|department_store|bakery|coffee|tea|books)$"]${nameFilter}${areaClause};
);
out center 220;
`.trim();
}

function mapOsmTagsToPoi(el: OverpassElement, _city: string): POI | null {
  const tags = el.tags;
  if (!tags || !tags.name) return null;

  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const amenity = tags.amenity ?? '';
  const shop = tags.shop ?? '';
  const tourism = tags.tourism ?? '';
  const historic = tags.historic ?? '';
  const leisure = tags.leisure ?? '';

  const categories: CategoryId[] = [];
  let suggestedMinutes = 65;
  let avgCostNtd = 150;
  let isIndoor = true;
  let typeLabel = '地圖景點';

  if (leisure === 'park' || leisure === 'garden' || leisure === 'nature_reserve' || tourism === 'viewpoint' || tourism === 'picnic_site') {
    categories.push('nature');
    isIndoor = false;
    suggestedMinutes = 70;
    avgCostNtd = 0;
    typeLabel = tourism === 'viewpoint' ? '觀景／秘境' : '公園／自然綠地';
  } else if (historic || amenity === 'place_of_worship') {
    categories.push('heritage');
    isIndoor = false;
    suggestedMinutes = 60;
    avgCostNtd = 0;
    typeLabel = amenity === 'place_of_worship' ? '廟宇／文化古蹟' : '歷史古蹟';
  } else if (tourism === 'theme_park' || tourism === 'zoo' || tourism === 'aquarium' || leisure === 'water_park') {
    categories.push('family');
    isIndoor = false;
    suggestedMinutes = 110;
    avgCostNtd = 300;
    typeLabel = '親子樂園／園區';
  } else if (tourism === 'museum' || tourism === 'gallery' || tourism === 'artwork' || amenity === 'arts_centre' || amenity === 'theatre') {
    categories.push('art');
    isIndoor = tourism !== 'artwork';
    suggestedMinutes = 85;
    avgCostNtd = 120;
    typeLabel = '藝文展館／美學空間';
  } else if (amenity === 'cafe' || shop === 'coffee' || shop === 'tea') {
    categories.push('cafe');
    if (amenity === 'restaurant') categories.push('food');
    suggestedMinutes = 60;
    avgCostNtd = 180;
    typeLabel = '咖啡廳／茶館';
  } else if (shop === 'mall' || shop === 'department_store' || shop === 'books' || amenity === 'marketplace') {
    categories.push('shop');
    isIndoor = amenity !== 'marketplace';
    suggestedMinutes = 85;
    avgCostNtd = 280;
    typeLabel = amenity === 'marketplace' ? '市集／市場' : '商場／選物書店';
  } else if (
    ['restaurant', 'fast_food', 'food_court', 'ice_cream'].includes(amenity) ||
    shop === 'bakery'
  ) {
    categories.push('food');
    suggestedMinutes = amenity === 'fast_food' ? 45 : 70;
    avgCostNtd = amenity === 'fast_food' || amenity === 'ice_cream' || shop === 'bakery' ? 150 : 320;
    typeLabel = tags.cuisine ? `料理：${tags.cuisine.replace(/;/g, '、')}` : '地圖餐廳／小吃';
  } else {
    categories.push('art');
    if (tourism === 'attraction') isIndoor = false;
    suggestedMinutes = 60;
    avgCostNtd = 50;
    typeLabel = '熱門打卡景點';
  }

  const district =
    tags['addr:district'] ||
    tags['addr:suburb'] ||
    tags['addr:street'] ||
    '地圖景點';

  const streetInfo = tags['addr:street']
    ? ` · ${tags['addr:street']}${tags['addr:housenumber'] ?? ''}`
    : '';

  return {
    id: `osm-${el.type}-${el.id}`,
    city: 'live',
    district,
    name: tags.name,
    lat,
    lng,
    categories,
    suggestedMinutes,
    avgCostNtd,
    openMinutes: 480,
    closeMinutes: 1320,
    closedDays: [],
    isIndoor,
    highlight: `${typeLabel}${streetInfo}`,
  };
}

export function parseOverpassElements(
  elements: OverpassElement[],
  city: string
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
  city: string,
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

  throw lastError ?? new Error('無法連線至地圖資料庫');
}
