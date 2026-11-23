import * as turf from '@turf/turf';
import type {
  DayPlan,
  GeoFilter,
  PaceMode,
  POI,
  PlannerConfig,
  ScheduledStop,
  TransitLeg,
  TransportMode,
} from '../types/planner';

const DETOUR_FACTOR = 1.3;

export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getGeoCenter(geoFilter: GeoFilter): { lat: number; lng: number } {
  if (geoFilter.mode === 'radius') return geoFilter.center;
  const coords = geoFilter.coordinates;
  if (coords.length === 0) return { lat: 24.155, lng: 120.655 };
  const unique = coords.length > 1 ? coords.slice(0, -1) : coords;
  const sum = unique.reduce(
    (acc, [lng, lat]) => ({ lat: acc.lat + lat, lng: acc.lng + lng }),
    { lat: 0, lng: 0 }
  );
  return {
    lat: sum.lat / unique.length,
    lng: sum.lng / unique.length,
  };
}

const TAIWAN_REGION_ANCHORS: Array<{ name: string; lat: number; lng: number }> = [
  { name: '台北大安／中正周邊', lat: 25.035, lng: 121.530 },
  { name: '台北信義／松山周邊', lat: 25.041, lng: 121.565 },
  { name: '台北大同／中山周邊', lat: 25.055, lng: 121.515 },
  { name: '北投／士林周邊', lat: 25.125, lng: 121.515 },
  { name: '淡水／北海岸周邊', lat: 25.175, lng: 121.435 },
  { name: '板橋／新北周邊', lat: 25.012, lng: 121.465 },
  { name: '基隆／東北角周邊', lat: 25.128, lng: 121.742 },
  { name: '桃園／中壢周邊', lat: 24.993, lng: 121.301 },
  { name: '新竹市區周邊', lat: 24.806, lng: 120.968 },
  { name: '苗栗／三義周邊', lat: 24.415, lng: 120.772 },
  { name: '台中西屯／北區周邊', lat: 24.160, lng: 120.652 },
  { name: '台中中區／西區周邊', lat: 24.142, lng: 120.675 },
  { name: '台中海線／清水梧棲', lat: 24.275, lng: 120.555 },
  { name: '彰化／鹿港周邊', lat: 24.065, lng: 120.495 },
  { name: '南投／日月潭周邊', lat: 23.865, lng: 120.915 },
  { name: '嘉義市區周邊', lat: 23.480, lng: 120.449 },
  { name: '台南府城／安平周邊', lat: 22.995, lng: 120.190 },
  { name: '高雄市區周邊', lat: 22.627, lng: 120.301 },
  { name: '宜蘭／羅東周邊', lat: 24.757, lng: 121.753 },
  { name: '花蓮市區周邊', lat: 23.987, lng: 121.601 },
];

export function getRegionLabel(geoFilter: GeoFilter): string {
  const center = getGeoCenter(geoFilter);
  let best = TAIWAN_REGION_ANCHORS[0];
  let bestDist = Infinity;
  for (const anchor of TAIWAN_REGION_ANCHORS) {
    const d = calcStraightDistanceKm(center, anchor);
    if (d < bestDist) {
      bestDist = d;
      best = anchor;
    }
  }
  if (bestDist > 35) {
    return `目前圈選區域 (${center.lat.toFixed(2)}, ${center.lng.toFixed(2)})`;
  }
  return best.name;
}

export function calcStraightDistanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  return turf.distance(
    turf.point([a.lng, a.lat]),
    turf.point([b.lng, b.lat]),
    { units: 'kilometers' }
  );
}

export function estimateTransitLeg(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  transportMode: TransportMode = 'scooter'
): TransitLeg {
  const straightKm = calcStraightDistanceKm(from, to);
  const distanceKm = Math.round(straightKm * DETOUR_FACTOR * 10) / 10;

  if (transportMode === 'walk') {
    const durationMinutes = Math.max(4, Math.round((distanceKm / 4.5) * 60));
    const isLongWalk = distanceKm > 1.5;
    return {
      distanceKm,
      durationMinutes,
      estimatedCostNtd: 0,
      modeLabel: '步行',
      costLabel: isLongWalk ? '步行距離較長' : '免費',
      isLongWalk,
    };
  }

  if (transportMode === 'transit') {
    const rideMins = Math.round((distanceKm / 18) * 60);
    const durationMinutes = Math.max(8, rideMins + 12);
    const estimatedCostNtd = distanceKm <= 5 ? 20 : 35;
    return {
      distanceKm,
      durationMinutes,
      estimatedCostNtd,
      modeLabel: '大眾運輸',
      costLabel: `車資約 NT$ ${estimatedCostNtd}`,
    };
  }

  if (transportMode === 'drive') {
    const driveMins = Math.round((distanceKm / 32) * 60);
    const durationMinutes = Math.max(5, driveMins + 4);
    const estimatedCostNtd = Math.round(distanceKm * 6 + 30);
    return {
      distanceKm,
      durationMinutes,
      estimatedCostNtd,
      modeLabel: '開車',
      costLabel: `油資停車約 NT$ ${estimatedCostNtd}`,
    };
  }

  // Default: 'scooter' (騎車)
  const rideMins = Math.round((distanceKm / 28) * 60);
  const durationMinutes = Math.max(4, rideMins + 2);
  const estimatedCostNtd = Math.round(Math.max(5, distanceKm * 4));
  return {
    distanceKm,
    durationMinutes,
    estimatedCostNtd,
    modeLabel: '騎車',
    costLabel: `油資約 NT$ ${estimatedCostNtd}`,
  };
}

export function getStayMinutes(poi: POI, pace: PaceMode): number {
  if (pace === 'relaxed') {
    return Math.min(120, Math.max(90, Math.round(poi.suggestedMinutes * 1.2)));
  }
  if (pace === 'packed') {
    return Math.min(60, Math.max(45, Math.round(poi.suggestedMinutes * 0.7)));
  }
  return Math.min(90, Math.max(60, poi.suggestedMinutes));
}

export function isPoiInGeoFilter(poi: POI, config: PlannerConfig): boolean {
  const pt = turf.point([poi.lng, poi.lat]);
  if (config.geoFilter.mode === 'polygon') {
    const coords = config.geoFilter.coordinates;
    if (coords.length < 4) return false;
    const poly = turf.polygon([coords]);
    return turf.booleanPointInPolygon(pt, poly);
  }
  const centerPt = turf.point([config.geoFilter.center.lng, config.geoFilter.center.lat]);
  const distKm = turf.distance(centerPt, pt, { units: 'kilometers' });
  return distKm <= config.geoFilter.maxDistanceKm;
}

export function filterEligiblePois(allPois: POI[], config: PlannerConfig): POI[] {
  const lockedSet = new Set(config.lockedPoiIds);
  const excludedSet = new Set(config.excludedPoiIds);
  const catSet = new Set(config.selectedCategories);

  return allPois.filter((poi) => {
    if (excludedSet.has(poi.id)) return false;
    if (!isPoiInGeoFilter(poi, config)) return false;
    if (poi.closedDays.includes(config.dayOfWeek)) return false;
    if (lockedSet.has(poi.id)) return true;
    return poi.categories.some((c) => catSet.has(c));
  });
}

/**
 * Nearest Neighbor + 2-opt route optimization
 */
export function optimizeRoute2Opt(pois: POI[], startCoord?: { lat: number; lng: number }): POI[] {
  if (pois.length <= 2) return [...pois];

  const remaining = [...pois];
  const ordered: POI[] = [];

  if (startCoord) {
    remaining.sort(
      (a, b) => calcStraightDistanceKm(startCoord, a) - calcStraightDistanceKm(startCoord, b)
    );
  }
  ordered.push(remaining.shift()!);

  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = calcStraightDistanceKm(last, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }

  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < ordered.length - 2; i++) {
      for (let j = i + 2; j < ordered.length - 1; j++) {
        const d1 =
          calcStraightDistanceKm(ordered[i], ordered[i + 1]) +
          calcStraightDistanceKm(ordered[j], ordered[j + 1]);
        const d2 =
          calcStraightDistanceKm(ordered[i], ordered[j]) +
          calcStraightDistanceKm(ordered[i + 1], ordered[j + 1]);
        if (d2 + 0.01 < d1) {
          const reversed = ordered.slice(i + 1, j + 1).reverse();
          ordered.splice(i + 1, j - i, ...reversed);
          improved = true;
        }
      }
    }
  }

  return ordered;
}

function resolvePoiWithRainySwap(
  poi: POI,
  config: PlannerConfig,
  allPois: POI[]
): {
  poi: POI;
  activeRainyPlanB: boolean;
  originalOutdoorPoi?: POI;
} {
  const backupId = config.rainySwaps[poi.id];
  if (backupId) {
    const backup = allPois.find((p) => p.id === backupId);
    if (backup) {
      return { poi: backup, activeRainyPlanB: true, originalOutdoorPoi: poi };
    }
  }
  return { poi, activeRainyPlanB: false };
}

function buildStopsFromSequence(
  sequence: POI[],
  config: PlannerConfig,
  allPois: POI[]
): ScheduledStop[] {
  const lockedSet = new Set(config.lockedPoiIds);
  const stops: ScheduledStop[] = [];
  let currentMinutes = config.startMinutes;

  for (let i = 0; i < sequence.length; i++) {
    const resolved = resolvePoiWithRainySwap(sequence[i], config, allPois);
    const poi = resolved.poi;
    const prevStop = stops[stops.length - 1];
    const transitFromPrev = prevStop
      ? estimateTransitLeg(prevStop.poi, poi, config.transportMode)
      : undefined;
    const arrival = currentMinutes + (transitFromPrev ? transitFromPrev.durationMinutes : 0);
    const stay = getStayMinutes(poi, config.pace);
    const departure = arrival + stay;

    const isLunchWindow = arrival >= 675 && arrival <= 825;
    const isDinnerWindow = arrival >= 1035 && arrival <= 1185;
    const isFood = poi.categories.includes('food');

    stops.push({
      poi,
      arrivalMinutes: arrival,
      departureMinutes: departure,
      stayMinutes: stay,
      transitFromPrev,
      isLocked: lockedSet.has(sequence[i].id) || lockedSet.has(poi.id),
      isMealSlot: isFood && (isLunchWindow || isDinnerWindow),
      activeRainyPlanB: resolved.activeRainyPlanB,
      originalOutdoorPoi: resolved.originalOutdoorPoi,
    });

    currentMinutes = departure;
  }

  return stops;
}

export function summarizePlan(
  stops: ScheduledStop[],
  eligibleCount: number,
  config: PlannerConfig,
  baseWarnings: string[] = []
): DayPlan {
  let totalTicketAndActivityCost = 0;
  let totalFoodCost = 0;
  let totalShopCost = 0;
  let totalTransitCost = 0;
  let totalDistanceKm = 0;

  stops.forEach((s) => {
    if (s.transitFromPrev) {
      totalTransitCost += s.transitFromPrev.estimatedCostNtd;
      totalDistanceKm += s.transitFromPrev.distanceKm;
    }

    const cats = s.poi.categories;
    if (cats.includes('food') || cats.includes('cafe')) {
      totalFoodCost += s.poi.avgCostNtd;
    } else if (cats.includes('shop')) {
      totalShopCost += s.poi.avgCostNtd;
    } else {
      totalTicketAndActivityCost += s.poi.avgCostNtd;
    }
  });

  const totalCostNtd =
    totalTicketAndActivityCost + totalFoodCost + totalShopCost + totalTransitCost;
  const isOverBudget = totalCostNtd > config.budgetNtd;
  const warnings = [...baseWarnings];

  if (isOverBudget) {
    warnings.push(
      `預估總花費 NT$ ${totalCostNtd.toLocaleString()} 已超出預算 NT$ ${config.budgetNtd.toLocaleString()}（超支 NT$ ${(totalCostNtd - config.budgetNtd).toLocaleString()}），建議移除高單價站點或提高預算。`
    );
  }

  return {
    stops,
    eligibleCount,
    totalTicketAndActivityCost,
    totalFoodCost,
    totalShopCost,
    totalTransitCost,
    totalCostNtd,
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    isOverBudget,
    warnings,
  };
}

export function generateDayPlan(allPois: POI[], config: PlannerConfig): DayPlan {
  const warnings: string[] = [];
  const eligible = filterEligiblePois(allPois, config);

  const foodPoolInArea = allPois.filter(
    (p) =>
      !config.excludedPoiIds.includes(p.id) &&
      !p.closedDays.includes(config.dayOfWeek) &&
      isPoiInGeoFilter(p, config) &&
      p.categories.includes('food')
  );

  if (eligible.length === 0) {
    return {
      stops: [],
      eligibleCount: 0,
      totalTicketAndActivityCost: 0,
      totalFoodCost: 0,
      totalShopCost: 0,
      totalTransitCost: 0,
      totalCostNtd: 0,
      totalDistanceKm: 0,
      isOverBudget: false,
      warnings: ['目前圈選範圍與條件內沒有符合的景點，請試著放大圈選範圍或增加景點類型。'],
    };
  }

  const startCoord = getGeoCenter(config.geoFilter);
  const lockedSet = new Set(config.lockedPoiIds);
  const usedIds = new Set<string>();
  const chosen: POI[] = [];

  const lockedPois = eligible.filter((p) => lockedSet.has(p.id));
  lockedPois.forEach((p) => {
    chosen.push(p);
    usedIds.add(p.id);
  });

  const totalHours = Math.max(1, (config.endMinutes - config.startMinutes) / 60);
  const maxStops =
    config.pace === 'relaxed'
      ? Math.min(6, Math.max(2, Math.floor(totalHours / 2.2)))
      : config.pace === 'packed'
        ? Math.min(9, Math.max(3, Math.floor(totalHours / 1.3)))
        : Math.min(7, Math.max(3, Math.floor(totalHours / 1.7)));

  let curTime = config.startMinutes;
  let consecutiveOutdoor = 0;
  let lunchAssigned = config.startMinutes > 810;
  let dinnerAssigned = config.startMinutes > 1170;

  if (!config.selectedCategories.includes('food')) {
    warnings.push('您未勾選「在地美食／小吃」，系統已於午／晚餐時段自動為您保留或安插用餐空檔。');
  }

  let safety = 0;
  while (chosen.length < maxStops && safety++ < 30) {
    const lastPoi = chosen[chosen.length - 1];
    const inLunchWindow = !lunchAssigned && curTime >= 660 && curTime <= 810;
    const inDinnerWindow = !dinnerAssigned && curTime >= 1020 && curTime <= 1170;
    const needMeal = inLunchWindow || inDinnerWindow;

    const pool = needMeal && foodPoolInArea.length > 0 ? foodPoolInArea : eligible;
    const candidates = pool.filter((p) => !usedIds.has(p.id));
    if (candidates.length === 0) break;

    const scored = candidates
      .map((cand) => {
        const dist = lastPoi
          ? calcStraightDistanceKm(lastPoi, cand)
          : calcStraightDistanceKm(startCoord, cand);
        const transit = lastPoi
          ? estimateTransitLeg(lastPoi, cand, config.transportMode)
          : { durationMinutes: 0, estimatedCostNtd: 0 };
        const arrival = curTime + transit.durationMinutes;
        const stay = getStayMinutes(cand, config.pace);
        const departure = arrival + stay;

        const isOpen = arrival >= cand.openMinutes && departure <= cand.closeMinutes;
        const fitsTime = departure <= config.endMinutes + 15;

        let score = dist * 2.0;
        if (!isOpen) score += 200;
        if (!fitsTime) score += 300;

        if (consecutiveOutdoor >= 2 && !cand.isIndoor && !cand.categories.includes('cafe')) {
          score += 25;
        }
        if (consecutiveOutdoor >= 2 && (cand.isIndoor || cand.categories.includes('cafe'))) {
          score -= 12;
        }

        if (needMeal && cand.categories.includes('food')) {
          score -= 30;
        } else if (!needMeal && cand.categories.includes('food') && lastPoi?.categories.includes('food')) {
          score += 18;
        }

        if (config.budgetTendency === 'saver') {
          score += cand.avgCostNtd / 50;
        } else if (config.budgetTendency === 'foodie' && cand.categories.includes('food')) {
          score -= 6;
        }

        return { cand, score, arrival, departure, isOpen, fitsTime };
      })
      .filter((x) => x.fitsTime && x.isOpen)
      .sort((a, b) => a.score - b.score);

    if (scored.length === 0) {
      if (needMeal) {
        if (inLunchWindow) lunchAssigned = true;
        if (inDinnerWindow) dinnerAssigned = true;
        curTime += 60;
        continue;
      }
      break;
    }

    const picked = scored[0];
    chosen.push(picked.cand);
    usedIds.add(picked.cand.id);
    curTime = picked.departure;

    if (picked.cand.isIndoor) consecutiveOutdoor = 0;
    else consecutiveOutdoor++;

    if (picked.cand.categories.includes('food')) {
      if (picked.arrival >= 660 && picked.arrival <= 840) lunchAssigned = true;
      if (picked.arrival >= 1020 && picked.arrival <= 1210) dinnerAssigned = true;
    }
  }

  let ordered = optimizeRoute2Opt(chosen, startCoord);
  let stops = buildStopsFromSequence(ordered, config, allPois);

  if (config.startMinutes <= 750 && config.endMinutes >= 780) {
    const hasLunchFood = stops.some(
      (s) => s.poi.categories.includes('food') && s.arrivalMinutes >= 660 && s.arrivalMinutes <= 840
    );
    if (!hasLunchFood) {
      const foodIdx = ordered.findIndex((p) => p.categories.includes('food'));
      if (foodIdx !== -1) {
        let bestSlot = 0;
        let bestDiff = Infinity;
        stops.forEach((s, idx) => {
          const diff = Math.abs(s.arrivalMinutes - 720);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestSlot = idx;
          }
        });
        const [foodItem] = ordered.splice(foodIdx, 1);
        ordered.splice(bestSlot, 0, foodItem);
        stops = buildStopsFromSequence(ordered, config, allPois);
      }
    }
  }

  const calcTotal = (st: ScheduledStop[]) =>
    st.reduce(
      (sum, s) => sum + s.poi.avgCostNtd + (s.transitFromPrev?.estimatedCostNtd ?? 0),
      0
    );

  let budgetGuard = 0;
  while (calcTotal(stops) > config.budgetNtd && budgetGuard++ < 10) {
    const expensiveIdx = stops
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => !s.isLocked && s.poi.avgCostNtd > 0)
      .sort((a, b) => b.s.poi.avgCostNtd - a.s.poi.avgCostNtd)[0]?.idx;

    if (expensiveIdx === undefined) break;

    const target = stops[expensiveIdx].poi;
    const usedSet = new Set(stops.map((s) => s.poi.id));
    const cheaper = eligible
      .filter(
        (p) =>
          !usedSet.has(p.id) &&
          p.avgCostNtd < target.avgCostNtd &&
          (target.categories.includes('food') ? p.categories.includes('food') : true)
      )
      .sort((a, b) => a.avgCostNtd - b.avgCostNtd)[0];

    if (!cheaper) break;
    ordered[expensiveIdx] = cheaper;
    stops = buildStopsFromSequence(ordered, config, allPois);
  }

  return summarizePlan(stops, eligible.length, config, warnings);
}

/**
 * Recalculate timing, transit legs, and budget after transport mode change or manual stop reordering
 */
export function recalculatePlanStops(
  currentStops: ScheduledStop[],
  eligibleCount: number,
  config: PlannerConfig,
  allPois: POI[]
): DayPlan {
  const seq = currentStops.map((s) => s.originalOutdoorPoi ?? s.poi);
  const rebuilt = buildStopsFromSequence(seq, config, allPois);
  const baseWarnings: string[] = [];
  if (!config.selectedCategories.includes('food')) {
    baseWarnings.push('您未勾選「在地美食／小吃」，系統已於午／晚餐時段自動為您保留或安插用餐空檔。');
  }
  return summarizePlan(rebuilt, eligibleCount, config, baseWarnings);
}

export function moveStopInPlan(
  currentPlan: DayPlan,
  index: number,
  direction: -1 | 1,
  config: PlannerConfig,
  allPois: POI[]
): DayPlan {
  const targetIdx = index + direction;
  if (targetIdx < 0 || targetIdx >= currentPlan.stops.length) return currentPlan;
  const copy = [...currentPlan.stops];
  const [moved] = copy.splice(index, 1);
  copy.splice(targetIdx, 0, moved);
  return recalculatePlanStops(copy, currentPlan.eligibleCount, config, allPois);
}

export function rerollSingleStop(
  currentPlan: DayPlan,
  stopIndex: number,
  allPois: POI[],
  config: PlannerConfig
): { nextConfig: PlannerConfig; nextPlan: DayPlan } {
  const target = currentPlan.stops[stopIndex];
  if (!target) return { nextConfig: config, nextPlan: currentPlan };

  const targetId = target.originalOutdoorPoi?.id ?? target.poi.id;
  const nextExcluded = Array.from(new Set([...config.excludedPoiIds, targetId]));
  const nextLocked = config.lockedPoiIds.filter((id) => id !== targetId);

  const nextConfig: PlannerConfig = {
    ...config,
    excludedPoiIds: nextExcluded,
    lockedPoiIds: nextLocked,
  };

  return {
    nextConfig,
    nextPlan: generateDayPlan(allPois, nextConfig),
  };
}
