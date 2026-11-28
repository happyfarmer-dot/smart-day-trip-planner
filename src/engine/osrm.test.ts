import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POIS } from '../data/pois';
import type { PlannerConfig } from '../types/planner';
import { buildOsrmUrl, clearOsrmCache, enrichPlanWithOsrm } from './osrm';
import { generateDayPlan } from './scheduler';

const baseConfig: PlannerConfig = {
  city: 'taichung',
  geoFilter: {
    mode: 'radius',
    center: { lat: 24.155, lng: 120.655 },
    maxDistanceKm: 15,
    intraZoneDistanceKm: 10,
  },
  selectedCategories: ['food', 'art', 'cafe', 'shop'],
  minRating: 4.0,
  minReviews: 50,
  startMinutes: 600, // 10:00
  endMinutes: 1080, // 18:00 (回到出發點的時間)
  pace: 'balanced',
  transportMode: 'drive',
  budgetNtd: 2000,
  budgetTendency: 'balanced',
  dayOfWeek: 6,
  lockedPoiIds: [],
  excludedPoiIds: [],
  rainySwaps: {},
};

describe('OSRM Routing & Return-Time Reservation', () => {
  beforeEach(() => {
    clearOsrmCache();
  });

  it('builds OSRM URLs for drive/scooter/walk and returns null for transit', () => {
    const pts = [
      { lat: 24.155, lng: 120.655 },
      { lat: 24.162, lng: 120.640 },
    ];
    expect(buildOsrmUrl(pts, 'drive')).toContain('router.project-osrm.org/route/v1/driving/');
    expect(buildOsrmUrl(pts, 'scooter')).toContain('router.project-osrm.org/route/v1/driving/');
    expect(buildOsrmUrl(pts, 'walk')).toContain('routed-foot/route/v1/foot/');
    expect(buildOsrmUrl(pts, 'transit')).toBeNull();
  });

  it('reserves return travel time in generateDayPlan so returnArrivalMinutes fits endMinutes', () => {
    const plan = generateDayPlan(POIS, baseConfig);
    expect(plan.stops.length).toBeGreaterThanOrEqual(2);
    expect(plan.returnLeg).toBeDefined();
    expect(plan.returnArrivalMinutes).toBeDefined();
    expect(plan.returnArrivalMinutes!).toBeLessThanOrEqual(baseConfig.endMinutes + 15);
  });

  it('enriches plan with real OSRM durations, distances, returnArrivalMinutes, and polyline geometry', async () => {
    const plan = generateDayPlan(POIS, baseConfig);
    const numLegs = plan.stops.length + 1; // outbound + (stops-1) + return

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            legs: Array.from({ length: numLegs }, () => ({
              distance: 5200, // 5.2 km
              duration: 720, // 12 min
            })),
            geometry: {
              coordinates: [
                [120.655, 24.155],
                [120.650, 24.158],
                [120.640, 24.162],
              ],
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const enriched = await enrichPlanWithOsrm(plan, baseConfig, mockFetch);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(enriched.isOsrmRouted).toBe(true);
    expect(enriched.routeGeometry).toEqual([
      [24.155, 120.655],
      [24.158, 120.650],
      [24.162, 120.640],
    ]);
    expect(enriched.outboundLeg?.isOsrm).toBe(true);
    expect(enriched.outboundLeg?.distanceKm).toBe(5.2);
    expect(enriched.outboundLeg?.durationMinutes).toBe(16); // 12 + 4 drive buffer
    expect(enriched.returnLeg?.isOsrm).toBe(true);
    expect(enriched.returnArrivalMinutes).toBe(
      enriched.stops[enriched.stops.length - 1].departureMinutes +
        enriched.returnLeg!.durationMinutes
    );
  });

  it('falls back to 1.3x estimation when OSRM fails', async () => {
    const plan = generateDayPlan(POIS, baseConfig);
    const failingFetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const result = await enrichPlanWithOsrm(plan, baseConfig, failingFetch);
    expect(result).toBe(plan);
    expect(result.isOsrmRouted).toBeUndefined();
    expect(result.routeGeometry).toBeUndefined();
  });

  it('does not call OSRM for transit mode (keeps single average speed)', async () => {
    const transitConfig: PlannerConfig = { ...baseConfig, transportMode: 'transit' };
    const plan = generateDayPlan(POIS, transitConfig);
    const mockFetch = vi.fn() as unknown as typeof fetch;

    const result = await enrichPlanWithOsrm(plan, transitConfig, mockFetch);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toBe(plan);
  });
});
