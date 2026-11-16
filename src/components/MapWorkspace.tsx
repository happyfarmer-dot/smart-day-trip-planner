import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import {
  Circle,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { CATEGORY_METAS } from '../data/pois';
import { isPoiInGeoFilter } from '../engine/scheduler';
import type { DayPlan, PlannerConfig, POI } from '../types/planner';

interface MapWorkspaceProps {
  config: PlannerConfig;
  allPois: POI[];
  plan: DayPlan;
  focusedPoiId: string | null;
  onUpdateConfig: (updater: (prev: PlannerConfig) => PlannerConfig) => void;
  onSelectPoi: (poiId: string) => void;
  onToggleLock?: (poiId: string) => void;
}

function createCategoryIcon(color: string, inRange: boolean) {
  return L.divIcon({
    className: 'custom-poi-dot',
    html: `<div style="
      width: ${inRange ? 14 : 10}px;
      height: ${inRange ? 14 : 10}px;
      border-radius: 9999px;
      background: ${inRange ? color : '#94a3b8'};
      border: 2px solid #ffffff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.35);
      opacity: ${inRange ? 1 : 0.45};
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function createNumberedIcon(num: number, isFocused: boolean) {
  return L.divIcon({
    className: 'custom-stop-badge',
    html: `<div style="
      width: ${isFocused ? 30 : 26}px;
      height: ${isFocused ? 30 : 26}px;
      border-radius: 9999px;
      background: ${isFocused ? '#1d4ed8' : '#2563eb'};
      color: #ffffff;
      font-weight: 700;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2.5px solid #ffffff;
      box-shadow: 0 2px 8px rgba(37,99,235,0.45);
    ">${num}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const anchorIcon = L.divIcon({
  className: 'custom-anchor-pin',
  html: `<div style="
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: #ef4444;
    border: 3px solid #ffffff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.4);
  "></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const MapController: React.FC<{
  config: PlannerConfig;
  allPois: POI[];
  focusedPoiId: string | null;
  onUpdateConfig: (updater: (prev: PlannerConfig) => PlannerConfig) => void;
}> = ({ config, allPois, focusedPoiId, onUpdateConfig }) => {
  const map = useMap();
  const prevCityRef = useRef(config.city);
  const drawnLayerRef = useRef<L.FeatureGroup | null>(null);
  const drawControlRef = useRef<L.Control | null>(null);

  // Recenter when city changes
  useEffect(() => {
    if (prevCityRef.current !== config.city) {
      prevCityRef.current = config.city;
      const target =
        config.city === 'taichung'
          ? ([24.155, 120.655] as [number, number])
          : ([25.045, 121.532] as [number, number]);
      map.flyTo(target, 12, { duration: 0.6 });
    }
  }, [config.city, map]);

  // Focus on clicked itinerary stop
  useEffect(() => {
    if (!focusedPoiId) return;
    const poi = allPois.find((p) => p.id === focusedPoiId);
    if (poi) {
      map.flyTo([poi.lat, poi.lng], Math.max(map.getZoom(), 14), { duration: 0.5 });
    }
  }, [focusedPoiId, allPois, map]);

  // Click map to move radius anchor
  useMapEvents({
    click(e) {
      if (config.geoFilter.mode === 'radius') {
        onUpdateConfig((prev) => ({
          ...prev,
          geoFilter:
            prev.geoFilter.mode === 'radius'
              ? {
                  ...prev.geoFilter,
                  center: { lat: e.latlng.lat, lng: e.latlng.lng },
                }
              : prev.geoFilter,
        }));
      }
    },
  });

  // Leaflet-Draw toolbar for Polygon / Rectangle mode
  useEffect(() => {
    if (config.geoFilter.mode !== 'polygon') {
      if (drawControlRef.current) {
        map.removeControl(drawControlRef.current);
        drawControlRef.current = null;
      }
      if (drawnLayerRef.current) {
        map.removeLayer(drawnLayerRef.current);
        drawnLayerRef.current = null;
      }
      return;
    }

    const drawnItems = new L.FeatureGroup();
    drawnLayerRef.current = drawnItems;
    map.addLayer(drawnItems);

    // Seed initial editable polygon
    if (config.geoFilter.coordinates.length >= 4) {
      const latLngs = config.geoFilter.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      const poly = L.polygon(latLngs, { color: '#2563eb', weight: 2, fillOpacity: 0.1 });
      drawnItems.addLayer(poly);
    }

    const DrawControl = (L.Control as unknown as { Draw: new (opts: Record<string, unknown>) => L.Control }).Draw;
    const control = new DrawControl({
      position: 'topright',
      draw: {
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false,
        polygon: {
          allowIntersection: false,
          shapeOptions: { color: '#2563eb', weight: 2 },
        },
        rectangle: {
          shapeOptions: { color: '#2563eb', weight: 2 },
        },
      },
      edit: {
        featureGroup: drawnItems,
        remove: false,
      },
    });

    drawControlRef.current = control;
    map.addControl(control);

    const extractPolygon = (layer: L.Polygon) => {
      const raw = layer.getLatLngs()[0] as L.LatLng[];
      if (!raw || raw.length < 3) return;
      const coords: [number, number][] = raw.map((ll) => [ll.lng, ll.lat]);
      coords.push(coords[0]); // close ring for Turf.js
      onUpdateConfig((prev) => ({
        ...prev,
        geoFilter: { mode: 'polygon', coordinates: coords },
      }));
    };

    const onCreated = (e: L.LeafletEvent & { layer: L.Polygon }) => {
      drawnItems.clearLayers();
      drawnItems.addLayer(e.layer);
      extractPolygon(e.layer);
    };

    const onEdited = (e: L.LeafletEvent & { layers: L.LayerGroup }) => {
      e.layers.eachLayer((layer) => {
        if (layer instanceof L.Polygon) {
          extractPolygon(layer);
        }
      });
    };

    map.on((L as unknown as { Draw: { Event: { CREATED: string; EDITED: string } } }).Draw.Event.CREATED, onCreated as L.LeafletEventHandlerFn);
    map.on((L as unknown as { Draw: { Event: { CREATED: string; EDITED: string } } }).Draw.Event.EDITED, onEdited as L.LeafletEventHandlerFn);

    return () => {
      map.off((L as unknown as { Draw: { Event: { CREATED: string; EDITED: string } } }).Draw.Event.CREATED, onCreated as L.LeafletEventHandlerFn);
      map.off((L as unknown as { Draw: { Event: { CREATED: string; EDITED: string } } }).Draw.Event.EDITED, onEdited as L.LeafletEventHandlerFn);
      map.removeControl(control);
      map.removeLayer(drawnItems);
    };
  }, [config.geoFilter.mode, map, onUpdateConfig]);

  return null;
};

export const MapWorkspace: React.FC<MapWorkspaceProps> = ({
  config,
  allPois,
  plan,
  focusedPoiId,
  onUpdateConfig,
  onSelectPoi,
  onToggleLock,
}) => {
  const cityPois = allPois.filter((p) => p.city === config.city);
  const stopOrderMap = new Map<string, number>();
  plan.stops.forEach((s, idx) => stopOrderMap.set(s.poi.id, idx + 1));

  const routeLatLngs: [number, number][] = plan.stops.map((s) => [
    s.poi.lat,
    s.poi.lng,
  ]);

  const initialCenter: [number, number] =
    config.city === 'taichung' ? [24.155, 120.655] : [25.045, 121.532];

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800">
            {config.city === 'taichung' ? '台中互動地圖' : '台北互動地圖'}
          </span>
          <span className="text-slate-500">
            {config.geoFilter.mode === 'radius'
              ? '· 點擊地圖移動出發錨點'
              : '· 使用右上角工具繪製或微調多邊形範圍'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-600">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-blue-600 text-white text-[9px] inline-flex items-center justify-center font-bold">
              1
            </span>
            已排入路線
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            範圍內景點
          </span>
        </div>
      </div>

      <div className="h-[380px] w-full relative" data-testid="map-container">
        <MapContainer
          center={initialCenter}
          zoom={12}
          className="h-full w-full z-0"
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapController
            config={config}
            allPois={allPois}
            focusedPoiId={focusedPoiId}
            onUpdateConfig={onUpdateConfig}
          />

          {/* 距離半徑圈 */}
          {config.geoFilter.mode === 'radius' && (
            <>
              <Circle
                center={[
                  config.geoFilter.center.lat,
                  config.geoFilter.center.lng,
                ]}
                radius={config.geoFilter.maxDistanceKm * 1000}
                pathOptions={{
                  color: '#2563eb',
                  weight: 2,
                  dashArray: '6 4',
                  fillColor: '#3b82f6',
                  fillOpacity: 0.08,
                }}
              />
              <Marker
                position={[
                  config.geoFilter.center.lat,
                  config.geoFilter.center.lng,
                ]}
                icon={anchorIcon}
              >
                <Popup>出發錨點（半徑 {config.geoFilter.maxDistanceKm} km）</Popup>
              </Marker>
            </>
          )}

          {/* 多邊形顯示（非編輯狀態輔助顯示） */}
          {config.geoFilter.mode === 'polygon' &&
            config.geoFilter.coordinates.length >= 4 && (
              <Polygon
                positions={config.geoFilter.coordinates.map(([lng, lat]) => [
                  lat,
                  lng,
                ] as [number, number])}
                pathOptions={{
                  color: '#2563eb',
                  weight: 1.5,
                  fillOpacity: 0.06,
                }}
              />
            )}

          {/* 路線折線 */}
          {routeLatLngs.length > 1 && (
            <Polyline
              positions={routeLatLngs}
              pathOptions={{
                color: '#2563eb',
                weight: 3.5,
                opacity: 0.85,
              }}
            />
          )}

          {/* 景點標記 */}
          {cityPois.map((poi) => {
            const stopOrder = stopOrderMap.get(poi.id);
            const inRange =
              isPoiInGeoFilter(poi, config) &&
              poi.categories.some((c) => config.selectedCategories.includes(c));
            const catColor =
              CATEGORY_METAS.find((c) => c.id === poi.categories[0])?.color ??
              '#3b82f6';

            return (
              <Marker
                key={poi.id}
                position={[poi.lat, poi.lng]}
                icon={
                  stopOrder
                    ? createNumberedIcon(stopOrder, focusedPoiId === poi.id)
                    : createCategoryIcon(catColor, inRange)
                }
                zIndexOffset={stopOrder ? 500 : inRange ? 100 : 0}
                eventHandlers={{
                  click: () => onSelectPoi(poi.id),
                }}
              >
                <Popup>
                  <div className="text-xs space-y-1 min-w-[160px]">
                    <div className="font-bold text-slate-900">
                      {stopOrder ? `#${stopOrder} ` : ''}
                      {poi.name}
                    </div>
                    <div className="text-slate-600">{poi.highlight}</div>
                    <div className="text-slate-500">
                      建議 {poi.suggestedMinutes} 分 ·{' '}
                      {poi.avgCostNtd > 0 ? `NT$ ${poi.avgCostNtd}` : '免費'}
                    </div>
                    {onToggleLock && (
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => onToggleLock(poi.id)}
                          className="flex-1 py-1 px-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700"
                        >
                          {config.lockedPoiIds.includes(poi.id)
                            ? '已設必去'
                            : '＋ 加入必去'}
                        </button>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${poi.lat},${poi.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-1 px-2 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium"
                        >
                          Google 地圖
                        </a>
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
};
