import { describe, expect, it } from 'vitest';
import { buildOverpassQuery, parseOverpassElements } from './overpass';

describe('Overpass Live Map Database Integration', () => {
  it('builds a valid radius query with keyword filter', () => {
    const q = buildOverpassQuery(
      {
        mode: 'radius',
        center: { lat: 24.155, lng: 120.655 },
        maxDistanceKm: 5,
      },
      '牛肉麵'
    );
    expect(q).toContain('(around:5000,24.15500,120.65500)');
    expect(q).toContain('牛肉麵');
    expect(q).toContain('restaurant|cafe|fast_food');
  });

  it('parses OSM dining elements into deduplicated POI objects', () => {
    const pois = parseOverpassElements(
      [
        {
          type: 'node',
          id: 101,
          lat: 24.15,
          lon: 120.66,
          tags: { name: '阿明牛肉麵', amenity: 'restaurant', cuisine: 'beef_noodle' },
        },
        {
          type: 'way',
          id: 102,
          center: { lat: 24.151, lon: 120.662 },
          tags: { name: '春風咖啡', amenity: 'cafe' },
        },
        {
          type: 'node',
          id: 103,
          lat: 24.15,
          lon: 120.66,
          tags: { name: '阿明牛肉麵', amenity: 'restaurant' }, // duplicate name
        },
      ],
      'taichung'
    );

    expect(pois.length).toBe(2);
    expect(pois[0].categories).toContain('food');
    expect(pois[1].categories).toContain('cafe');
    expect(pois[0].highlight).toContain('地圖資料庫');
  });
});
