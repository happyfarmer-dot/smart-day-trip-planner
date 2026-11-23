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

const BREAKFAST_KEYWORDS = ['早餐', '豆漿', '蛋餅', '早午餐', '美而美', '拉亞'];
const FAST_FOOD_CHAINS = ['麥當勞', '肯德基', '摩斯漢堡', '漢堡王', '星巴克', '路易莎', '85度c', 'mcdonald', 'kfc', 'starbucks'];

export function isBreakfastPlace(poi: POI): boolean {
  const n = poi.name.toLowerCase();
  return BREAKFAST_KEYWORDS.some((k) => n.includes(k));
}

export function isChainFastFood(poi: POI): boolean {
  const n = poi.name.toLowerCase();
  return FAST_FOOD_CHAINS.some((k) => n.includes(k));
}

export function isDiningPoi(poi: POI): boolean {
  return poi.categories.includes('food') || poi.categories.includes('cafe');
}

export function isAttractionPoi(poi: POI): boolean {
  return poi.categories.some((c) =>
    ['nature', 'art', 'heritage', 'family', 'shop'].includes(c)
  );
}

export function calcReputationScore(poi: POI): number {
  const r = poi.rating ?? 4.2;
  const rev = poi.reviewCount ?? 80;
  return r * Math.log10(rev + 10);
}

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
    const estimatedCostNtd = distanceKm <= 5 ? 20 : distanceKm <= 25 ? 45 : 150;
    return {
      distanceKm,
      durationMinutes,
      estimatedCostNtd,
      modeLabel: '大眾運輸',
      costLabel: `車資約 NT$ ${estimatedCostNtd}`,
    };
  }

  if (transportMode === 'drive') {
    const driveMins = Math.round((distanceKm / 42) * 60);
    const durationMinutes = Math.max(5, driveMins + 4);
    const estimatedCostNtd = Math.round(distanceKm * 5 + 30);
    return {
      distanceKm,
      durationMinutes,
      estimatedCostNtd,
      modeLabel: '開車',
      costLabel: `油資停車約 NT$ ${estimatedCostNtd}`,
    };
  }

  // Default: 'scooter' (騎車)
  const rideMins = Math.round((distanceKm / 30) * 60);
  const durationMinutes = Math.max(4, rideMins + 2);
  const estimatedCostNtd = Math.round(Math.max(5, distanceKm * 3.5));
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
  const centerPt = turf.point([
    config.geoFilter.center.lng,
    config.geoFilter.center.lat,
  ]);
  const distKm = turf.distance(centerPt, pt, { units: 'kilometers' });
  return distKm <= config.geoFilter.maxDistanceKm;
}

export function meetsRatingFilter(
  poi: POI,
  minRating: number,
  minReviews: number
): boolean {
  if (minRating > 0 && (poi.rating ?? 0) < minRating) return false;
  if (minReviews > 0 && (poi.reviewCount ?? 0) < minReviews) return false;
  return true;
}

export function filterEligiblePois(
  allPois: POI[],
  config: PlannerConfig,
  overrideRating?: number,
  overrideReviews?: number
): POI[] {
  const lockedSet = new Set(config.lockedPoiIds);
  const excludedSet = new Set(config.excludedPoiIds);
  const catSet = new Set(config.selectedCategories);
  const minR = overrideRating ?? config.minRating;
  const minRev = overrideReviews ?? config.minReviews;

  return allPois.filter((poi) => {
    if (excludedSet.has(poi.id)) return false;
    if (!isPoiInGeoFilter(poi, config)) return false;
    if (poi.closedDays.includes(config.dayOfWeek)) return false;
    if (lockedSet.has(poi.id)) return true;
    if (!poi.categories.some((c) => catSet.has(c))) return false;
    return meetsRatingFilter(poi, minR, minRev);
  });
}

export function findNearestRainyBackup(
  poi: POI,
  allPois: POI[]
): POI | undefined {
  if (poi.isIndoor) return undefined;
  if (poi.rainyBackupId) {
    const explicit = allPois.find((p) => p.id === poi.rainyBackupId);
    if (explicit) return explicit;
  }
  let best: POI | undefined;
  let bestDist = 3.0;
  for (const cand of allPois) {
    if (cand.id === poi.id) continue;
    if (
      !cand.isIndoor &&
      !cand.categories.includes('cafe') &&
      !cand.categories.includes('art')
    ) {
      continue;
    }
    const d = calcStraightDistanceKm(poi, cand);
    if (d <= bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

export function optimizeRoute2Opt(
  pois: POI[],
  startCoord?: { lat: number; lng: number }
): POI[] {
  if (pois.length <= 2) return [...pois];

  const remaining = [...pois];
  const ordered: POI[] = [];
  if (startCoord) ordered.push(remaining.shift()!);
  else ordered.push(remaining.shift()!);

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
    for (let i = 1; i < ordered.length - 2; i++) {
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
  allPois: POI[],
  outboundLeg?: TransitLeg
): ScheduledStop[] {
  const lockedSet = new Set(config.lockedPoiIds);
  const stops: ScheduledStop[] = [];
  let currentMinutes =
    config.startMinutes + (outboundLeg ? outboundLeg.durationMinutes : 0);

  for (let i = 0; i < sequence.length; i++) {
    const resolved = resolvePoiWithRainySwap(sequence[i], config, allPois);
    const poi = resolved.poi;
    const prevStop = stops[stops.length - 1];
    const transitFromPrev = prevStop
      ? estimateTransitLeg(prevStop.poi, poi, config.transportMode)
      : undefined;
    const arrival =
      currentMinutes + (transitFromPrev ? transitFromPrev.durationMinutes : 0);
    const stay = getStayMinutes(poi, config.pace);
    const departure = arrival + stay;

    const isLunchWindow = arrival >= 690 && arrival <= 810; // 11:30 - 13:30
    const isDinnerWindow = arrival >= 1050 && arrival <= 1170; // 17:30 - 19:30
    const isFood = poi.categories.includes('food');

    const autoRainyBackupPoi = !poi.isIndoor
      ? findNearestRainyBackup(poi, allPois)
      : undefined;

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
      autoRainyBackupPoi,
    });

    currentMinutes = departure;
  }

  return stops;
}

export function summarizePlan(
  stops: ScheduledStop[],
  eligibleCount: number,
  config: PlannerConfig,
  baseWarnings: string[] = [],
  outboundLeg?: TransitLeg
): DayPlan {
  let totalTicketAndActivityCost = 0;
  let totalFoodCost = 0;
  let totalShopCost = 0;
  let totalTransitCost = outboundLeg ? outboundLeg.estimatedCostNtd : 0;
  let totalDistanceKm = outboundLeg ? outboundLeg.distanceKm : 0;

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

  const anchor = getGeoCenter(config.geoFilter);
  const returnLeg =
    config.geoFilter.mode === 'radius' && stops.length > 0
      ? estimateTransitLeg(
          stops[stops.length - 1].poi,
          anchor,
          config.transportMode
        )
      : undefined;

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
    outboundLeg,
    returnLeg,
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

function pickExpeditionSeedPoi(
  attractions: POI[],
  anchor: { lat: number; lng: number },
  maxDistanceKm: number,
  intraZoneKm: number
): POI | undefined {
  if (maxDistanceKm <= 15 || attractions.length === 0) return undefined;

  const minOuter = maxDistanceKm * 0.5;
  const outerCandidates = attractions.filter((p) => {
    const d = calcStraightDistanceKm(anchor, p);
    return d >= minOuter && d <= maxDistanceKm;
  });

  if (outerCandidates.length === 0) return undefined;

  const scored = outerCandidates.map((cand) => {
    const neighborCount = attractions.filter(
      (other) =>
        other.id !== cand.id && calcStraightDistanceKm(cand, other) <= intraZoneKm
    ).length;
    const score = neighborCount * 4 + calcReputationScore(cand);
    return { cand, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.cand;
}

export function generateDayPlan(allPois: POI[], config: PlannerConfig): DayPlan {
  const warnings: string[] = [];

  // Auto-relaxation if strict rating/review thresholds yield < 2 attractions or 0 dining
  let effectiveRating = config.minRating;
  let effectiveReviews = config.minReviews;
  let eligible = filterEligiblePois(allPois, config, effectiveRating, effectiveReviews);
  let relaxed = false;

  const hasEnoughPools = (list: POI[]) => {
    const attrCount = list.filter(isAttractionPoi).length;
    const foodCount = list.filter((p) => p.categories.includes('food')).length;
    return attrCount >= 2 && (foodCount >= 1 || !config.selectedCategories.includes('food'));
  };

  if (!hasEnoughPools(eligible) && effectiveReviews > 0) {
    effectiveReviews = 0;
    eligible = filterEligiblePois(allPois, config, effectiveRating, 0);
    relaxed = true;
  }
  while (!hasEnoughPools(eligible) && effectiveRating > 0) {
    effectiveRating = Math.max(0, Math.round((effectiveRating - 0.3) * 10) / 10);
    if (effectiveRating < 3.0) effectiveRating = 0;
    eligible = filterEligiblePois(allPois, config, effectiveRating, effectiveReviews);
    relaxed = true;
  }

  if (relaxed && config.minRating > 0) {
    warnings.push(
      `⚠️ 該區域符合 ${config.minRating}★+ 的店家較少，已自動放寬部分站點門檻以確保行程完整。`
    );
  }

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

  // Dual-Pool Isolation: Attractions Pool vs Dining Pool
  const attractionPoolAll = eligible.filter(isAttractionPoi);
  const diningPoolAll = allPois.filter(
    (p) =>
      !config.excludedPoiIds.includes(p.id) &&
      !p.closedDays.includes(config.dayOfWeek) &&
      isPoiInGeoFilter(p, config) &&
      isDiningPoi(p) &&
      meetsRatingFilter(p, effectiveRating, effectiveReviews)
  );

  const anchor = getGeoCenter(config.geoFilter);
  const isRadiusMode = config.geoFilter.mode === 'radius';
  const maxR = config.geoFilter.mode === 'radius' ? config.geoFilter.maxDistanceKm : 15;
  const intraR = config.geoFilter.mode === 'radius' ? config.geoFilter.intraZoneDistanceKm : 15;

  const lockedSet = new Set(config.lockedPoiIds);
  const usedIds = new Set<string>();
  const chosen: POI[] = [];

  const lockedPois = eligible.filter((p) => lockedSet.has(p.id));
  if (lockedPois.length > 0) {
    lockedPois.forEach((p) => {
      chosen.push(p);
      usedIds.add(p.id);
    });
  } else {
    // Stop 1 MUST come from Attractions Pool (unless departing right at lunch peak 11:30-13:00)
    const isLunchPeakStart = config.startMinutes >= 690 && config.startMinutes <= 780;
    const seed = pickExpeditionSeedPoi(attractionPoolAll, anchor, maxR, intraR);
    if (seed) {
      chosen.push(seed);
      usedIds.add(seed.id);
    } else if (!isLunchPeakStart && attractionPoolAll.length > 0) {
      const sortedAttr = [...attractionPoolAll].sort(
        (a, b) => calcReputationScore(b) - calcReputationScore(a)
      );
      chosen.push(sortedAttr[0]);
      usedIds.add(sortedAttr[0].id);
    }
  }

  const seedAnchor = chosen[0] ?? anchor;
  const zoneAttractions =
    isRadiusMode && maxR > 15 && chosen[0]
      ? attractionPoolAll.filter(
          (p) => calcStraightDistanceKm(seedAnchor, p) <= intraR * 1.3
        )
      : attractionPoolAll;
  const zoneDining =
    isRadiusMode && maxR > 15 && chosen[0]
      ? diningPoolAll.filter(
          (p) => calcStraightDistanceKm(seedAnchor, p) <= intraR * 1.3
        )
      : diningPoolAll;

  const initialOutbound =
    isRadiusMode && chosen[0]
      ? estimateTransitLeg(anchor, chosen[0], config.transportMode)
      : undefined;

  const totalHours = Math.max(1, (config.endMinutes - config.startMinutes) / 60);
  const maxStops =
    config.pace === 'relaxed'
      ? Math.min(6, Math.max(3, Math.floor(totalHours / 2.2)))
      : config.pace === 'packed'
        ? Math.min(8, Math.max(4, Math.floor(totalHours / 1.4)))
        : Math.min(7, Math.max(4, Math.floor(totalHours / 1.7)));

  let curTime =
    config.startMinutes + (initialOutbound ? initialOutbound.durationMinutes : 0);
  if (chosen[0]) {
    curTime += getStayMinutes(chosen[0], config.pace);
  }

  let foodMealsCount = chosen.filter((p) => p.categories.includes('food')).length;
  let lunchAssigned = config.startMinutes > 810;
  let dinnerAssigned = config.startMinutes > 1170;

  if (!config.selectedCategories.includes('food')) {
    warnings.push('您未勾選「在地美食／小吃」，系統已於午／晚餐時段自動為您保留或安插用餐空檔。');
  }

  let safety = 0;
  while (chosen.length < maxStops && safety++ < 30) {
    const lastPoi = chosen[chosen.length - 1];
    const inLunchWindow = !lunchAssigned && curTime >= 680 && curTime <= 810; // 11:20 - 13:30
    const inDinnerWindow = !dinnerAssigned && curTime >= 1040 && curTime <= 1170; // 17:20 - 19:30
    const needMeal = (inLunchWindow || inDinnerWindow) && foodMealsCount < 2;

    // Strict Dual-Pool Isolation:
    // - Only pick from food dining pool during lunch/dinner windows (max 2 meals total)
    // - Never pick back-to-back food
    const prevWasFood = lastPoi?.categories.includes('food') ?? false;
    const useFoodPool = needMeal && !prevWasFood && zoneDining.length > 0;

    const rawPool = useFoodPool
      ? zoneDining.filter((p) => p.categories.includes('food'))
      : zoneAttractions.length > 0
        ? zoneAttractions
        : eligible.filter((p) => !p.categories.includes('food'));

    const candidates = rawPool.filter((p) => {
      if (usedIds.has(p.id)) return false;
      // Breakfast filter: only allowed before 11:00 (660)
      if (isBreakfastPlace(p) && curTime >= 660) return false;
      return true;
    });

    if (candidates.length === 0) {
      if (needMeal) {
        if (inLunchWindow) lunchAssigned = true;
        if (inDinnerWindow) dinnerAssigned = true;
        curTime += 60;
        continue;
      }
      break;
    }

    const scored = candidates
      .map((cand) => {
        const dist = lastPoi
          ? calcStraightDistanceKm(lastPoi, cand)
          : calcStraightDistanceKm(anchor, cand);
        const transit = lastPoi
          ? estimateTransitLeg(lastPoi, cand, config.transportMode)
          : { durationMinutes: 0, estimatedCostNtd: 0 };
        const arrival = curTime + transit.durationMinutes;
        const stay = getStayMinutes(cand, config.pace);
        const departure = arrival + stay;

        const isOpen = arrival >= cand.openMinutes && departure <= cand.closeMinutes;
        const fitsTime = departure <= config.endMinutes + 15;

        // Reputation-weighted score: rating * log10(reviewCount + 10)
        const rep = calcReputationScore(cand);
        let score = dist * 1.5 - rep * 1.8;

        if (!isOpen) score += 200;
        if (!fitsTime) score += 300;
        if (isChainFastFood(cand)) score += 40; // Downweight chain fast food

        if (config.budgetTendency === 'saver') {
          score += cand.avgCostNtd / 50;
        } else if (config.budgetTendency === 'foodie' && cand.categories.includes('food')) {
          score -= 5;
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

    if (picked.cand.categories.includes('food')) {
      foodMealsCount++;
      if (inLunchWindow) lunchAssigned = true;
      if (inDinnerWindow) dinnerAssigned = true;
    }
  }

  const ordered = optimizeRoute2Opt(chosen, anchor);
  const finalOutbound =
    isRadiusMode && ordered[0]
      ? estimateTransitLeg(anchor, ordered[0], config.transportMode)
      : undefined;

  const stops = buildStopsFromSequence(ordered, config, allPois, finalOutbound);
  return summarizePlan(stops, eligible.length, config, warnings, finalOutbound);
}

export function recalculatePlanStops(
  currentStops: ScheduledStop[],
  eligibleCount: number,
  config: PlannerConfig,
  allPois: POI[]
): DayPlan {
  const seq = currentStops.map((s) => s.originalOutdoorPoi ?? s.poi);
  const anchor = getGeoCenter(config.geoFilter);
  const outboundLeg =
    config.geoFilter.mode === 'radius' && seq[0]
      ? estimateTransitLeg(anchor, seq[0], config.transportMode)
      : undefined;
  const rebuilt = buildStopsFromSequence(seq, config, allPois, outboundLeg);
  const baseWarnings: string[] = [];
  if (!config.selectedCategories.includes('food')) {
    baseWarnings.push('您未勾選「在地美食／小吃」，系統已於午／晚餐時段自動為您保留或安插用餐空檔。');
  }
  return summarizePlan(rebuilt, eligibleCount, config, baseWarnings, outboundLeg);
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
