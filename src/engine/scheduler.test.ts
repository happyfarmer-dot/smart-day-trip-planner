import { describe, expect, it } from 'vitest';
import { POIS } from '../data/pois';
import type { PlannerConfig } from '../types/planner';
import { generateDayPlan, rerollSingleStop } from './scheduler';
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
      startMinutes: 600, // 10:00
      endMinutes: 1200, // 20:00
      pace: 'balanced',
      budgetNtd: 1500,
      budgetTendency: 'balanced',
      dayOfWeek: 6, // Saturday
      lockedPoiIds: [],
      excludedPoiIds: [],
      rainySwaps: {},
    };

    const plan = generateDayPlan(POIS, config);
    expect(plan.stops.length).toBeGreaterThanOrEqual(3);

    // Check no overlapping time slots
    for (let i = 1; i < plan.stops.length; i++) {
      expect(plan.stops[i].arrivalMinutes).toBeGreaterThanOrEqual(
        plan.stops[i - 1].departureMinutes
      );
    }

    // Check lunch window (11:30 - 13:30) has a food stop
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
        // Box around Taipei Datong / Zhongzheng
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
