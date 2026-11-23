import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Map as MapIcon, X } from 'lucide-react';
import { FilterSidebar } from './components/FilterSidebar';
import { ItineraryTimeline } from './components/ItineraryTimeline';
import { MapWorkspace } from './components/MapWorkspace';
import { POIS } from './data/pois';
import {
  fetchGooglePlacesPois,
  getSavedGoogleMapsApiKey,
  saveGoogleMapsApiKey,
} from './engine/googlePlaces';
import { fetchLiveMapPois } from './engine/overpass';
import {
  filterEligiblePois,
  findNearestRainyBackup,
  generateDayPlan,
  moveStopInPlan,
  recalculatePlanStops,
  rerollSingleStop,
} from './engine/scheduler';
import type { PlannerConfig, POI, TransportMode } from './types/planner';

const INITIAL_CONFIG: PlannerConfig = {
  city: 'taichung',
  geoFilter: {
    mode: 'radius',
    center: { lat: 24.155, lng: 120.655 },
    maxDistanceKm: 30,
    intraZoneDistanceKm: 10,
  },
  selectedCategories: ['food', 'art', 'cafe', 'shop'],
  minRating: 4.0,
  minReviews: 50,
  startMinutes: 600, // 10:00
  endMinutes: 1200, // 20:00
  pace: 'balanced',
  transportMode: 'scooter',
  budgetNtd: 1500,
  budgetTendency: 'balanced',
  dayOfWeek: 6, // Saturday
  lockedPoiIds: [],
  excludedPoiIds: [],
  rainySwaps: {},
};

function mergePoiLists(base: POI[], extra: POI[]): POI[] {
  const seen = new Set(base.map((p) => p.name.trim().toLowerCase()));
  const merged = [...base];
  for (const lp of extra) {
    const key = lp.name.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(lp);
    }
  }
  return merged;
}

export function App() {
  const [config, setConfig] = useState<PlannerConfig>(INITIAL_CONFIG);
  const [livePois, setLivePois] = useState<POI[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFetchingMap, setIsFetchingMap] = useState(false);
  const [mapDbStatus, setMapDbStatus] = useState<string | null>(null);
  const [focusedPoiId, setFocusedPoiId] = useState<string | null>(null);
  const [flyTrigger, setFlyTrigger] = useState(0);
  const [mobileTarget, setMobileTarget] = useState<'map' | 'itinerary'>('map');

  const [gmapsKey, setGmapsKey] = useState(() => getSavedGoogleMapsApiKey());
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyDraft, setKeyDraft] = useState(() => getSavedGoogleMapsApiKey());

  const allPois = useMemo(() => mergePoiLists(POIS, livePois), [livePois]);
  const [plan, setPlan] = useState(() => generateDayPlan(POIS, INITIAL_CONFIG));

  const eligibleCount = useMemo(
    () => filterEligiblePois(allPois, config).length,
    [allPois, config]
  );

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allPois
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.highlight.toLowerCase().includes(q) ||
          p.district.toLowerCase().includes(q)
      )
      .slice(0, 15);
  }, [allPois, searchQuery]);

  const handleFetchLiveMapDb = useCallback(
    async (keyword?: string, silent = false) => {
      setIsFetchingMap(true);
      if (!silent) setMapDbStatus(null);
      try {
        const useGoogle = Boolean(gmapsKey.trim());
        const fetched = useGoogle
          ? await fetchGooglePlacesPois(
              gmapsKey,
              config.geoFilter,
              config.city,
              keyword
            )
          : await fetchLiveMapPois(config.geoFilter, config.city, keyword);

        setLivePois((prev) => {
          const byId = new Map(prev.map((p) => [p.id, p]));
          fetched.forEach((p) => byId.set(p.id, p));
          return Array.from(byId.values());
        });

        const sourceLabel = useGoogle
          ? 'Google Maps Places'
          : 'OpenStreetMap 地圖資料庫';
        setMapDbStatus(
          fetched.length > 0
            ? `已從 ${sourceLabel} 同步 ${fetched.length} 筆景點與店家至候選池。`
            : '此範圍內未找到更多符合條件的地圖資料。'
        );
      } catch (err) {
        const gmapsErrMsg =
          err instanceof Error ? err.message : 'Google Maps API 查詢失敗';
        try {
          const fallback = await fetchLiveMapPois(
            config.geoFilter,
            config.city,
            keyword
          );
          setLivePois((prev) => {
            const byId = new Map(prev.map((p) => [p.id, p]));
            fallback.forEach((p) => byId.set(p.id, p));
            return Array.from(byId.values());
          });
          setMapDbStatus(
            `${gmapsErrMsg}（已自動切換 OpenStreetMap 同步 ${fallback.length} 筆景點）`
          );
        } catch {
          if (!silent) setMapDbStatus(gmapsErrMsg);
        }
      } finally {
        setIsFetchingMap(false);
      }
    },
    [gmapsKey, config.geoFilter, config.city]
  );

  // 800ms Debounce auto-sync when anchor, radius, polygon, or city changes
  useEffect(() => {
    const timer = setTimeout(() => {
      handleFetchLiveMapDb(undefined, true);
    }, 800);
    return () => clearTimeout(timer);
  }, [config.city, config.geoFilter, handleFetchLiveMapDb]);

  const handleGenerate = () => {
    const cleaned: PlannerConfig = {
      ...config,
      excludedPoiIds: [],
      rainySwaps: {},
    };
    setConfig(cleaned);
    setPlan(generateDayPlan(allPois, cleaned));
  };

  const handleTransportChange = (mode: TransportMode) => {
    const nextConfig: PlannerConfig = { ...config, transportMode: mode };
    setConfig(nextConfig);
    setPlan((prev) =>
      prev.stops.length > 0
        ? recalculatePlanStops(prev.stops, prev.eligibleCount, nextConfig, allPois)
        : generateDayPlan(allPois, nextConfig)
    );
  };

  const handleToggleLock = (poiId: string) => {
    const isLocked = config.lockedPoiIds.includes(poiId);
    const nextConfig: PlannerConfig = {
      ...config,
      lockedPoiIds: isLocked
        ? config.lockedPoiIds.filter((id) => id !== poiId)
        : [...config.lockedPoiIds, poiId],
    };
    setConfig(nextConfig);
    setPlan(generateDayPlan(allPois, nextConfig));
  };

  const handleRerollStop = (index: number) => {
    const { nextConfig, nextPlan } = rerollSingleStop(
      plan,
      index,
      allPois,
      config
    );
    setConfig(nextConfig);
    setPlan(nextPlan);
  };

  const handleMoveStop = (index: number, direction: -1 | 1) => {
    setPlan((prev) => moveStopInPlan(prev, index, direction, config, allPois));
  };

  const handleCityPreset = (city: 'taichung' | 'taipei') => {
    const center =
      city === 'taichung'
        ? { lat: 24.155, lng: 120.655 }
        : { lat: 25.045, lng: 121.532 };
    const nextConfig: PlannerConfig = {
      ...config,
      city,
      geoFilter: {
        mode: 'radius',
        center,
        maxDistanceKm:
          config.geoFilter.mode === 'radius'
            ? config.geoFilter.maxDistanceKm
            : 30,
        intraZoneDistanceKm:
          config.geoFilter.mode === 'radius'
            ? config.geoFilter.intraZoneDistanceKm
            : 10,
      },
      lockedPoiIds: [],
      excludedPoiIds: [],
      rainySwaps: {},
    };
    setConfig(nextConfig);
    setFlyTrigger((n) => n + 1);
    setPlan(generateDayPlan(allPois, nextConfig));
  };

  const handleToggleRainyPlanB = (originalPoi: POI) => {
    const nextSwaps = { ...config.rainySwaps };
    if (nextSwaps[originalPoi.id]) {
      delete nextSwaps[originalPoi.id];
    } else {
      const backup = findNearestRainyBackup(originalPoi, allPois);
      if (backup) nextSwaps[originalPoi.id] = backup.id;
    }
    const nextConfig: PlannerConfig = {
      ...config,
      rainySwaps: nextSwaps,
    };
    setConfig(nextConfig);
    setPlan(generateDayPlan(allPois, nextConfig));
  };

  const handleSaveGmapsKey = () => {
    saveGoogleMapsApiKey(keyDraft);
    setGmapsKey(keyDraft.trim());
    setShowKeyModal(false);
    setLivePois([]);
  };

  const handleMobileFloatingScroll = () => {
    const targetId = mobileTarget === 'map' ? 'map-section' : 'itinerary-section';
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const itinEl = document.getElementById('itinerary-section');
    if (!itinEl || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setMobileTarget('map');
        } else {
          setMobileTarget('itinerary');
        }
      },
      { threshold: 0.15 }
    );
    obs.observe(itinEl);
    return () => obs.disconnect();
  }, [plan.stops.length]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <MapIcon className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-slate-900">
                智慧旅程安排系統（Smart Day-Trip Planner）
              </h1>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                空間圈選自動同步 · 多交通工具估算 · 4 類預算拆解 · Google Maps 導航匯出
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 hidden md:inline tabular-nums">
              候選資料庫：{allPois.length} 筆
            </span>
            <button
              type="button"
              onClick={() => setShowKeyModal((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                gmapsKey
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              {gmapsKey ? '已啟用 Google Maps API' : '連接 Google Maps API'}
            </button>
          </div>
        </div>

        {/* Google Maps API Key 設定面板 */}
        {showKeyModal && (
          <div className="max-w-[1440px] mx-auto mt-3 p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-700">
              Google Maps API 金鑰：
            </span>
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="貼上 AIza... 開頭的 API 金鑰（僅存於瀏覽器 localStorage）"
              className="flex-1 min-w-[240px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
            />
            <button
              type="button"
              onClick={handleSaveGmapsKey}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700"
            >
              儲存並切換資料源
            </button>
            <button
              type="button"
              onClick={() => setShowKeyModal(false)}
              className="p-1.5 text-slate-500 hover:text-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start pb-20 md:pb-6">
        {/* Left Sidebar */}
        <aside className="lg:col-span-4 xl:col-span-3">
          <FilterSidebar
            config={config}
            eligibleCount={eligibleCount}
            searchQuery={searchQuery}
            searchResults={searchResults}
            isFetchingMap={isFetchingMap}
            mapDbStatus={mapDbStatus}
            onSearchQueryChange={setSearchQuery}
            onSearchSubmit={(kw) => handleFetchLiveMapDb(kw)}
            onFocusPoi={(id) => setFocusedPoiId(id)}
            onToggleLock={handleToggleLock}
            onCityPreset={handleCityPreset}
            onChange={setConfig}
            onTransportChange={handleTransportChange}
            onGenerate={handleGenerate}
          />
        </aside>

        {/* Right Area: Map + Timeline */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-5">
          <MapWorkspace
            config={config}
            allPois={allPois}
            plan={plan}
            focusedPoiId={focusedPoiId}
            flyTrigger={flyTrigger}
            onUpdateConfig={setConfig}
            onSelectPoi={(id) => setFocusedPoiId(id)}
            onToggleLock={handleToggleLock}
          />

          <ItineraryTimeline
            plan={plan}
            config={config}
            allPois={allPois}
            focusedPoiId={focusedPoiId}
            onFocusStop={(id) => setFocusedPoiId(id)}
            onToggleLock={handleToggleLock}
            onRerollStop={handleRerollStop}
            onMoveStop={handleMoveStop}
            onToggleRainyPlanB={handleToggleRainyPlanB}
          />
        </div>
      </main>

      {/* 手機版懸浮快速切換按鈕 */}
      {plan.stops.length > 0 && (
        <button
          type="button"
          data-testid="mobile-float-toggle"
          onClick={handleMobileFloatingScroll}
          className="md:hidden fixed bottom-5 right-4 z-40 px-4 py-2.5 rounded-full bg-slate-900/85 backdrop-blur text-white text-xs font-semibold shadow-lg border border-white/15 active:scale-95 transition"
        >
          {mobileTarget === 'map' ? '🗺️ 看地圖' : '📋 看行程'}
        </button>
      )}
    </div>
  );
}

export default App;
