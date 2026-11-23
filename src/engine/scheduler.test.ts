import { describe, expect, it } from 'vitest';
import { POIS } from '../data/pois';
import type { PlannerConfig } from '../types/planner';
import {
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
        maxDistanceKm: 8,
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
        maxDistanceKm: 4,
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

  it('computes distinct transit durations for scooter vs transit vs walk & dynamic region label', () => {
    const a = { lat: 24.150, lng: 120.650 };
    const b = { lat: 24.165, lng: 120.660 }; // ~1.9 km straight * 1.3 ~ 2.4 km
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
        maxDistanceKm: 5,
      })
    ).toContain('彰化');
  });

  it('rerolls a single stop and builds valid Google Maps directions URL', () => {
    const config: PlannerConfig = {
      city: 'taichung',
      geoFilter: {
        mode: 'radius',
        center: { lat: 24.155, lng: 120.655 },
        maxDistanceKm: 8,
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
