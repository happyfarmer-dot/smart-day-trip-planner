import * as turf from '@turf/turf';
import type {
  DayPlan,
  PaceMode,
  POI,
  PlannerConfig,
  ScheduledStop,
  TransitLeg,
} from '../types/planner';

const DETOUR_FACTOR = 1.3;
const PARKING_WALK_BUFFER_MIN = 15;

export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
  to: { lat: number; lng: number }
): TransitLeg {
  const straightKm = calcStraightDistanceKm(from, to);
  const distanceKm = Math.round(straightKm * DETOUR_FACTOR * 10) / 10;

  if (distanceKm <= 1.1) {
    const durationMinutes = Math.max(5, Math.round((distanceKm / 4.5) * 60));
    return {
      distanceKm,
      durationMinutes,
      estimatedCostNtd: 0,
      modeLabel: '步行',
    };
  }

  if (distanceKm <= 6.5) {
    const driveMins = Math.round((distanceKm / 22) * 60);
    return {
      distanceKm,
      durationMinutes: driveMins + PARKING_WALK_BUFFER_MIN,
      estimatedCostNtd: 25,
      modeLabel: '大眾運輸 / 騎車',
    };
  }

  const driveMins = Math.round((distanceKm / 32) * 60);
  return {
    distanceKm,
    durationMinutes: driveMins + PARKING_WALK_BUFFER_MIN,
    estimatedCostNtd: Math.round(85 + distanceKm * 20),
    modeLabel: '開車 / 計程車',
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
    if (poi.city !== config.city) return false;
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

  // Pick initial node closest to startCoord (or first node)
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

  // 2-opt improvement pass
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

function resolvePoiWithRainySwap(poi: POI, config: PlannerConfig, allPois: POI[]): {
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
    const transitFromPrev = prevStop ? estimateTransitLeg(prevStop.poi, poi) : undefined;
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

export function generateDayPlan(allPois: POI[], config: PlannerConfig): DayPlan {
  const warnings: string[] = [];
  const eligible = filterEligiblePois(allPois, config);

  // Also gather food POIs in geoFilter even if user didn't select 'food'
  const foodPoolInArea = allPois.filter(
    (p) =>
      p.city === config.city &&
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
      totalTransitCost: 0,
      totalCostNtd: 0,
      totalDistanceKm: 0,
      isOverBudget: false,
      warnings: ['目前圈選範圍與條件內沒有符合的景點，請試著放大圈選範圍或增加景點類型。'],
    };
  }

  const startCoord =
    config.geoFilter.mode === 'radius'
      ? config.geoFilter.center
      : { lat: eligible[0].lat, lng: eligible[0].lng };

  const lockedSet = new Set(config.lockedPoiIds);
  const usedIds = new Set<string>();
  const chosen: POI[] = [];

  // Prioritize locked POIs first
  const lockedPois = eligible.filter((p) => lockedSet.has(p.id));
  lockedPois.forEach((p) => {
    chosen.push(p);
    usedIds.add(p.id);
  });

  // Determine target stop count by duration & pace
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

  // Greedy selection with opening hours, meal alignment, fatigue prevention, & budget tendency
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
        const transit = lastPoi ? estimateTransitLeg(lastPoi, cand) : { durationMinutes: 0, estimatedCostNtd: 0 };
        const arrival = curTime + transit.durationMinutes;
        const stay = getStayMinutes(cand, config.pace);
        const departure = arrival + stay;

        const isOpen = arrival >= cand.openMinutes && departure <= cand.closeMinutes;
        const fitsTime = departure <= config.endMinutes + 15;

        let score = dist * 2.0;
        if (!isOpen) score += 200;
        if (!fitsTime) score += 300;

        // Fatigue prevention: after 2 consecutive outdoor spots, strongly prefer indoor or cafe
        if (consecutiveOutdoor >= 2 && !cand.isIndoor && !cand.categories.includes('cafe')) {
          score += 25;
        }
        if (consecutiveOutdoor >= 2 && (cand.isIndoor || cand.categories.includes('cafe'))) {
          score -= 12;
        }

        // Meal alignment bonus
        if (needMeal && cand.categories.includes('food')) {
          score -= 30;
        } else if (!needMeal && cand.categories.includes('food') && lastPoi?.categories.includes('food')) {
          score += 18;
        }

        // Budget tendency weighting
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

  // Run 2-opt route optimization
  let ordered = optimizeRoute2Opt(chosen, startCoord);

  // Build initial stops and ensure lunch food stop stays in lunch window (11:00-14:00)
  let stops = buildStopsFromSequence(ordered, config, allPois);
  if (config.startMinutes <= 750 && config.endMinutes >= 780) {
    const hasLunchFood = stops.some(
      (s) => s.poi.categories.includes('food') && s.arrivalMinutes >= 660 && s.arrivalMinutes <= 840
    );
    if (!hasLunchFood) {
      const foodIdx = ordered.findIndex((p) => p.categories.includes('food'));
      if (foodIdx !== -1) {
        // Find slot closest to 12:00 (720)
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

  // Budget control: if over budget, try downgrading expensive unlocked stops
  const calcTotal = (st: ScheduledStop[]) =>
    st.reduce(
      (sum, s) => sum + s.poi.avgCostNtd + (s.transitFromPrev?.estimatedCostNtd ?? 0),
      0
    );

  let budgetGuard = 0;
  while (calcTotal(stops) > config.budgetNtd && budgetGuard++ < 10) {
    // Find most expensive unlocked stop
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

  // Summarize costs
  let totalTicketAndActivityCost = 0;
  let totalFoodCost = 0;
  let totalTransitCost = 0;
  let totalDistanceKm = 0;

  stops.forEach((s) => {
    if (s.transitFromPrev) {
      totalTransitCost += s.transitFromPrev.estimatedCostNtd;
      totalDistanceKm += s.transitFromPrev.distanceKm;
    }
    if (s.poi.categories.includes('food')) totalFoodCost += s.poi.avgCostNtd;
    else totalTicketAndActivityCost += s.poi.avgCostNtd;
  });

  const totalCostNtd = totalTicketAndActivityCost + totalFoodCost + totalTransitCost;
  const isOverBudget = totalCostNtd > config.budgetNtd;

  if (isOverBudget) {
    warnings.push(
      `預估總花費 NT$ ${totalCostNtd.toLocaleString()} 已超出預算 NT$ ${config.budgetNtd.toLocaleString()}（超支 NT$ ${(totalCostNtd - config.budgetNtd).toLocaleString()}），建議移除高單價站點或提高預算。`
    );
  }

  return {
    stops,
    eligibleCount: eligible.length,
    totalTicketAndActivityCost,
    totalFoodCost,
    totalTransitCost,
    totalCostNtd,
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    isOverBudget,
    warnings,
  };
}

/**
 * Reroll a single stop with another eligible candidate in the area
 */
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
