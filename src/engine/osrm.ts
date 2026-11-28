import type {
  DayPlan,
  PlannerConfig,
  ScheduledStop,
  TransitLeg,
  TransportMode,
} from '../types/planner';
import { formatMinutes, getGeoCenter } from './scheduler';

export interface OsrmLegMetric {
  distanceKm: number;
  durationMinutes: number;
}

export interface OsrmRouteResult {
  legs: OsrmLegMetric[];
  geometry: [number, number][]; // [lat, lng][] for Leaflet Polyline
}

const routeCache = new Map<string, OsrmRouteResult>();

export function clearOsrmCache(): void {
  routeCache.clear();
}

export function buildOsrmUrl(
  waypoints: Array<{ lat: number; lng: number }>,
  transportMode: TransportMode
): string | null {
  if (transportMode === 'transit' || waypoints.length < 2) return null;
  const coords = waypoints
    .map((pt) => `${pt.lng.toFixed(5)},${pt.lat.toFixed(5)}`)
    .join(';');

  if (transportMode === 'walk') {
    return `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coords}?overview=full&geometries=geojson&steps=false`;
  }
  // 'drive' and 'scooter' both use OSRM driving road network
  return `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
}

export function buildTransitLegFromOsrm(
  distanceKm: number,
  rawDurationMinutes: number,
  transportMode: TransportMode
): TransitLeg {
  const roundedDist = Math.round(distanceKm * 10) / 10;

  if (transportMode === 'walk') {
    const durationMinutes = Math.max(4, Math.round(rawDurationMinutes));
    const isLongWalk = roundedDist > 1.5;
    return {
      distanceKm: roundedDist,
      durationMinutes,
      estimatedCostNtd: 0,
      modeLabel: '步行',
      costLabel: isLongWalk ? '步行距離較長' : '免費',
      isLongWalk,
      isOsrm: true,
    };
  }

  if (transportMode === 'drive') {
    const durationMinutes = Math.max(5, Math.round(rawDurationMinutes) + 4);
    const estimatedCostNtd = Math.round(roundedDist * 5 + 30);
    return {
      distanceKm: roundedDist,
      durationMinutes,
      estimatedCostNtd,
      modeLabel: '開車',
      costLabel: `油資停車約 NT$ ${estimatedCostNtd}`,
      isOsrm: true,
    };
  }

  // 'scooter' (騎車)
  const durationMinutes = Math.max(4, Math.round(rawDurationMinutes) + 2);
  const estimatedCostNtd = Math.round(Math.max(5, roundedDist * 3.5));
  return {
    distanceKm: roundedDist,
    durationMinutes,
    estimatedCostNtd,
    modeLabel: '騎車',
    costLabel: `油資約 NT$ ${estimatedCostNtd}`,
    isOsrm: true,
  };
}

export async function fetchOsrmRoute(
  waypoints: Array<{ lat: number; lng: number }>,
  transportMode: TransportMode,
  fetchFn: typeof fetch = fetch
): Promise<OsrmRouteResult | null> {
  const url = buildOsrmUrl(waypoints, transportMode);
  if (!url) return null;

  const cacheKey = `${transportMode}|${url}`;
  const cached = routeCache.get(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{
        legs?: Array<{ distance?: number; duration?: number }>;
        geometry?: { coordinates?: [number, number][] };
      }>;
    };

    if (data.code !== 'Ok' || !data.routes?.[0]) return null;
    const route = data.routes[0];
    const rawLegs = route.legs ?? [];
    const rawCoords = route.geometry?.coordinates ?? [];

    if (rawLegs.length !== waypoints.length - 1 || rawCoords.length < 2) {
      return null;
    }

    const legs: OsrmLegMetric[] = rawLegs.map((leg) => ({
      distanceKm: (leg.distance ?? 0) / 1000,
      durationMinutes: (leg.duration ?? 0) / 60,
    }));

    const geometry: [number, number][] = rawCoords.map(([lng, lat]) => [lat, lng]);
    const result: OsrmRouteResult = { legs, geometry };
    routeCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichPlanWithOsrm(
  plan: DayPlan,
  config: PlannerConfig,
  fetchFn: typeof fetch = fetch
): Promise<DayPlan> {
  if (config.transportMode === 'transit' || plan.stops.length === 0) {
    return plan;
  }

  const anchor = getGeoCenter(config.geoFilter);
  const hasOutbound = Boolean(plan.outboundLeg);
  const hasReturn = Boolean(plan.returnLeg);

  const waypoints: Array<{ lat: number; lng: number }> = [];
  if (hasOutbound) waypoints.push(anchor);
  plan.stops.forEach((s) => waypoints.push({ lat: s.poi.lat, lng: s.poi.lng }));
  if (hasReturn) waypoints.push(anchor);

  if (waypoints.length < 2) return plan;

  const osrm = await fetchOsrmRoute(waypoints, config.transportMode, fetchFn);
  if (!osrm || osrm.legs.length !== waypoints.length - 1) {
    // 失敗降級：維持原本 1.3x 估算
    return plan;
  }

  let legIdx = 0;
  const outboundLeg = hasOutbound
    ? buildTransitLegFromOsrm(
        osrm.legs[legIdx].distanceKm,
        osrm.legs[legIdx].durationMinutes,
        config.transportMode
      )
    : undefined;
  if (hasOutbound) legIdx++;

  let currentMinutes =
    config.startMinutes + (outboundLeg ? outboundLeg.durationMinutes : 0);

  let totalTransitCost = outboundLeg ? outboundLeg.estimatedCostNtd : 0;
  let totalDistanceKm = outboundLeg ? outboundLeg.distanceKm : 0;

  const updatedStops: ScheduledStop[] = plan.stops.map((stop, idx) => {
    let transitFromPrev: TransitLeg | undefined;
    if (idx > 0) {
      const m = osrm.legs[legIdx++];
      transitFromPrev = buildTransitLegFromOsrm(
        m.distanceKm,
        m.durationMinutes,
        config.transportMode
      );
      totalTransitCost += transitFromPrev.estimatedCostNtd;
      totalDistanceKm += transitFromPrev.distanceKm;
    }

    const arrival =
      currentMinutes + (transitFromPrev ? transitFromPrev.durationMinutes : 0);
    const departure = arrival + stop.stayMinutes;
    currentMinutes = departure;

    return {
      ...stop,
      arrivalMinutes: arrival,
      departureMinutes: departure,
      transitFromPrev,
    };
  });

  const returnLeg = hasReturn
    ? buildTransitLegFromOsrm(
        osrm.legs[legIdx].distanceKm,
        osrm.legs[legIdx].durationMinutes,
        config.transportMode
      )
    : undefined;

  const returnArrivalMinutes =
    returnLeg && updatedStops.length > 0
      ? updatedStops[updatedStops.length - 1].departureMinutes +
        returnLeg.durationMinutes
      : undefined;

  const totalCostNtd =
    plan.totalTicketAndActivityCost +
    plan.totalFoodCost +
    plan.totalShopCost +
    totalTransitCost;
  const isOverBudget = totalCostNtd > config.budgetNtd;

  const filteredWarnings = plan.warnings.filter(
    (w) => !w.startsWith('預估總花費') && !w.startsWith('預計返抵出發點時間')
  );
  if (isOverBudget) {
    filteredWarnings.push(
      `預估總花費 NT$ ${totalCostNtd.toLocaleString()} 已超出預算 NT$ ${config.budgetNtd.toLocaleString()}（超支 NT$ ${(totalCostNtd - config.budgetNtd).toLocaleString()}），建議移除高單價站點或提高預算。`
    );
  }
  if (
    returnArrivalMinutes !== undefined &&
    returnArrivalMinutes > config.endMinutes + 15
  ) {
    filteredWarnings.push(
      `預計返抵出發點時間 ${formatMinutes(returnArrivalMinutes)} 已超過設定的回到出發點時間 ${formatMinutes(config.endMinutes)}，建議縮短停留時間或減少站點。`
    );
  }

  return {
    ...plan,
    stops: updatedStops,
    outboundLeg,
    returnLeg,
    returnArrivalMinutes,
    routeGeometry: osrm.geometry,
    isOsrmRouted: true,
    totalTransitCost,
    totalCostNtd,
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    isOverBudget,
    warnings: filteredWarnings,
  };
}
