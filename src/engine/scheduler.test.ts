import { describe, expect, it } from 'vitest';
import { POIS } from '../data/pois';
import type { PlannerConfig } from '../types/planner';
import { extractTaiwanDistrict, buildRingSampleCenters } from './googlePlaces';
import {
  calcStraightDistanceKm,
  estimateTransitLeg,
  generateDayPlan,
  getRegionLabel,
  rerollSingleStop,
} from './scheduler';
import { buildGoogleMapsDirUrl } from './export';

describe('Smart Day-Trip Scheduler', () => {
  it('generates a non-overlapping itinerary in Taichung Xitun-North District with lunch aligned', () => {
    const config: PlannerConfig = {
      city: 'taichung',
      geoFilter: {
        mode: 'radius',
        center: { lat: 24.155, lng: 120.655 },
        maxDistanceKm: 12,
        intraZoneDistanceKm: 8,
      },
      selectedCategories: ['food', 'art', 'cafe'],
      startMinutes: 600,
      endMinutes: 1200,
      pace: 'balanced',
      transportMode: 'scooter',
      budgetNtd: 1500,
      budgetTendency: 'balanced',
      dayOfWeek: 6,
      lockedPoiIds: [],
      excludedPoiIds: [],
      rainySwaps: {},
    };

    const plan = generateDayPlan(POIS, config);
    expect(plan.stops.length).toBeGreaterThanOrEqual(3);

    for (let i = 1; i < plan.stops.length; i++) {
      expect(plan.stops[i].arrivalMinutes).toBeGreaterThanOrEqual(
        plan.stops[i - 1].departureMinutes
      );
    }

    const hasLunchFood = plan.stops.some(
      (s) =>
        s.poi.categories.includes('food') &&
        s.arrivalMinutes >= 660 &&
        s.arrivalMinutes <= 840
    );
    expect(hasLunchFood).toBe(true);
  });

  it('uses Seed-First Outward Clustering when maxDistanceKm=60 and intraZoneDistanceKm=12', () => {
    const anchor = { lat: 24.155, lng: 120.655 }; // Taichung Xitun
    const config: PlannerConfig = {
      city: 'taichung',
      geoFilter: {
        mode: 'radius',
        center: anchor,
        maxDistanceKm: 60,
        intraZoneDistanceKm: 12,
      },
      selectedCategories: ['nature', 'art', 'heritage', 'food', 'cafe', 'shop'],
      startMinutes: 540, // 09:00
      endMinutes: 1200, // 20:00
      pace: 'balanced',
      transportMode: 'drive',
      budgetNtd: 2500,
      budgetTendency: 'balanced',
      dayOfWeek: 6,
      lockedPoiIds: [],
      excludedPoiIds: [],
      rainySwaps: {},
    };

    const plan = generateDayPlan(POIS, config);
    expect(plan.stops.length).toBeGreaterThanOrEqual(3);
    expect(plan.outboundLeg).toBeDefined();

    // Stop 1 must be in the 0.5R - 1.0R outer ring (30 - 60 km from Taichung Xitun)
    const stop1Dist = calcStraightDistanceKm(anchor, plan.stops[0].poi);
    expect(stop1Dist).toBeGreaterThanOrEqual(30);
    expect(stop1Dist).toBeLessThanOrEqual(60);

    // Stops 2+ must cluster within 12 km of Stop 1
    for (let i = 1; i < plan.stops.length; i++) {
      const clusterDist = calcStraightDistanceKm(plan.stops[0].poi, plan.stops[i].poi);
      expect(clusterDist).toBeLessThanOrEqual(12);
    }
  });

  it('filters correctly in polygon mode using Turf.js', () => {
    const config: PlannerConfig = {
      city: 'taipei',
      geoFilter: {
        mode: 'polygon',
        coordinates: [
          [121.50, 25.03],
          [121.535, 25.03],
          [121.535, 25.06],
          [121.50, 25.06],
          [121.50, 25.03],
        ],
      },
      selectedCategories: ['heritage', 'food', 'art', 'cafe'],
      startMinutes: 540,
      endMinutes: 1080,
      pace: 'balanced',
      transportMode: 'transit',
      budgetNtd: 2000,
      budgetTendency: 'balanced',
      dayOfWeek: 0,
      lockedPoiIds: [],
      excludedPoiIds: [],
      rainySwaps: {},
    };

    const plan = generateDayPlan(POIS, config);
    expect(plan.stops.length).toBeGreaterThan(0);
    plan.stops.forEach((s) => {
      expect(s.poi.lng).toBeGreaterThanOrEqual(121.50);
      expect(s.poi.lng).toBeLessThanOrEqual(121.535);
    });
  });

  it('categorizes cafe into totalFoodCost and shop into totalShopCost, not tickets', () => {
    const config: PlannerConfig = {
      city: 'taichung',
      geoFilter: {
        mode: 'radius',
        center: { lat: 24.150, lng: 120.664 },
        maxDistanceKm: 5,
        intraZoneDistanceKm: 5,
      },
      selectedCategories: ['cafe', 'shop'],
      startMinutes: 600,
      endMinutes: 1080,
      pace: 'balanced',
      transportMode: 'scooter',
      budgetNtd: 3000,
      budgetTendency: 'balanced',
      dayOfWeek: 6,
      lockedPoiIds: ['tc-parklane', 'tc-cama-roastery'],
      excludedPoiIds: [],
      rainySwaps: {},
    };

    const plan = generateDayPlan(POIS, config);
    expect(plan.totalFoodCost).toBeGreaterThan(0);
    expect(plan.totalShopCost).toBeGreaterThan(0);
    expect(plan.totalTicketAndActivityCost).toBe(0);
  });

  it('extracts clean Taiwan district names and builds ring sample points > 25km', () => {
    expect(extractTaiwanDistrict('407台灣臺中市西屯區大石里中科路2966號')).toBe('西屯區');
    expect(extractTaiwanDistrict('505彰化縣鹿港鎮中山路430號')).toBe('鹿港鎮');
    expect(extractTaiwanDistrict('110台北市信義區市府路45號')).toBe('信義區');

    const ringPts = buildRingSampleCenters({ lat: 24.155, lng: 120.655 }, 60);
    expect(ringPts.length).toBeGreaterThanOrEqual(4);
  });

  it('computes distinct transit durations for scooter vs transit vs walk & dynamic region label', () => {
    const a = { lat: 24.150, lng: 120.650 };
    const b = { lat: 24.165, lng: 120.660 };
    const scooterLeg = estimateTransitLeg(a, b, 'scooter');
    const transitLeg = estimateTransitLeg(a, b, 'transit');
    const walkLeg = estimateTransitLeg(a, b, 'walk');

    expect(scooterLeg.modeLabel).toBe('騎車');
    expect(transitLeg.modeLabel).toBe('大眾運輸');
    expect(transitLeg.durationMinutes).toBeGreaterThan(scooterLeg.durationMinutes);
    expect(walkLeg.isLongWalk).toBe(true);

    expect(
      getRegionLabel({
        mode: 'radius',
        center: { lat: 24.065, lng: 120.495 },
        maxDistanceKm: 15,
        intraZoneDistanceKm: 10,
      })
    ).toContain('彰化');
  });

  it('rerolls a single stop and builds valid Google Maps directions URL', () => {
    const config: PlannerConfig = {
      city: 'taichung',
      geoFilter: {
        mode: 'radius',
        center: { lat: 24.155, lng: 120.655 },
        maxDistanceKm: 10,
        intraZoneDistanceKm: 10,
      },
      selectedCategories: ['food', 'art', 'cafe', 'shop'],
      startMinutes: 600,
      endMinutes: 1200,
      pace: 'balanced',
      transportMode: 'scooter',
      budgetNtd: 1500,
      budgetTendency: 'balanced',
      dayOfWeek: 6,
      lockedPoiIds: [],
      excludedPoiIds: [],
      rainySwaps: {},
    };

    const plan = generateDayPlan(POIS, config);
    const firstId = plan.stops[0].poi.id;
    const { nextPlan } = rerollSingleStop(plan, 0, POIS, config);
    expect(nextPlan.stops.some((s) => s.poi.id === firstId)).toBe(false);

    const url = buildGoogleMapsDirUrl(nextPlan.stops);
    expect(url).toContain('https://www.google.com/maps/dir/?api=1');
    expect(url).toContain('origin=');
    expect(url).toContain('destination=');
  });
});
