import { useMemo, useState } from 'react';
import { Database, Loader2, Map as MapIcon, Pin, Search } from 'lucide-react';
import { FilterSidebar } from './components/FilterSidebar';
import { ItineraryTimeline } from './components/ItineraryTimeline';
import { MapWorkspace } from './components/MapWorkspace';
import { POIS } from './data/pois';
import { fetchLiveMapPois } from './engine/overpass';
import {
  filterEligiblePois,
  generateDayPlan,
  rerollSingleStop,
} from './engine/scheduler';
import type { PlannerConfig, POI } from './types/planner';

const INITIAL_CONFIG: PlannerConfig = {
  city: 'taichung',
  geoFilter: {
    mode: 'radius',
    center: { lat: 24.155, lng: 120.655 },
    maxDistanceKm: 8,
  },
  selectedCategories: ['food', 'art', 'cafe', 'shop'],
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

export function App() {
  const [config, setConfig] = useState<PlannerConfig>(INITIAL_CONFIG);
  const [livePois, setLivePois] = useState<POI[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFetchingMap, setIsFetchingMap] = useState(false);
  const [mapDbStatus, setMapDbStatus] = useState<string | null>(null);
  const [focusedPoiId, setFocusedPoiId] = useState<string | null>(null);

  // Merge curated POIs + live OSM Overpass POIs (deduplicated by name)
  const allPois = useMemo(() => {
    const seen = new Set(POIS.map((p) => p.name.trim().toLowerCase()));
    const merged = [...POIS];
    for (const lp of livePois) {
      const key = lp.name.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(lp);
      }
    }
    return merged;
  }, [livePois]);

  const [plan, setPlan] = useState(() => generateDayPlan(POIS, INITIAL_CONFIG));

  const eligibleCount = useMemo(
    () => filterEligiblePois(allPois, config).length,
    [allPois, config]
  );

  // Local + Live search matches for quick inspection & pinning
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allPois
      .filter(
        (p) =>
          p.city === config.city &&
          (p.name.toLowerCase().includes(q) ||
            p.highlight.toLowerCase().includes(q) ||
            p.district.toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [allPois, config.city, searchQuery]);

  const handleGenerate = (customPois?: POI[], customConfig?: PlannerConfig) => {
    const targetConfig = customConfig ?? {
      ...config,
      excludedPoiIds: [],
      rainySwaps: {},
    };
    if (!customConfig) setConfig(targetConfig);
    setPlan(generateDayPlan(customPois ?? allPois, targetConfig));
  };

  const handleFetchLiveMapDb = async (keyword?: string) => {
    setIsFetchingMap(true);
    setMapDbStatus(null);
    try {
      const fetched = await fetchLiveMapPois(
        config.geoFilter,
        config.city,
        keyword
      );
      setLivePois((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        fetched.forEach((p) => byId.set(p.id, p));
        return Array.from(byId.values());
      });
      const mergedNow = (() => {
        const seen = new Set(POIS.map((p) => p.name.trim().toLowerCase()));
        const out = [...POIS];
        const combined = [...livePois, ...fetched];
        for (const lp of combined) {
          const k = lp.name.trim().toLowerCase();
          if (!seen.has(k)) {
            seen.add(k);
            out.push(lp);
          }
        }
        return out;
      })();

      setMapDbStatus(
        fetched.length > 0
          ? `已從 OpenStreetMap 地圖資料庫撈取 ${fetched.length} 筆真實店家／景點，並納入搜尋與排程候選。`
          : '此範圍內未找到更多符合關鍵字的地圖店家，可嘗試放大範圍或換個關鍵字。'
      );
      setPlan(generateDayPlan(mergedNow, config));
    } catch {
      setMapDbStatus('地圖資料庫連線逾時，目前使用內建離線景點與美食資料庫。');
    } finally {
      setIsFetchingMap(false);
    }
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

  const handleToggleRainyPlanB = (originalPoi: POI) => {
    const nextSwaps = { ...config.rainySwaps };
    if (nextSwaps[originalPoi.id]) {
      delete nextSwaps[originalPoi.id];
    } else if (originalPoi.rainyBackupId) {
      nextSwaps[originalPoi.id] = originalPoi.rainyBackupId;
    } else {
      const indoor = allPois.find(
        (p) =>
          p.city === originalPoi.city && p.isIndoor && p.id !== originalPoi.id
      );
      if (indoor) nextSwaps[originalPoi.id] = indoor.id;
    }
    const nextConfig: PlannerConfig = {
      ...config,
      rainySwaps: nextSwaps,
    };
    setConfig(nextConfig);
    setPlan(generateDayPlan(allPois, nextConfig));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <MapIcon className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-slate-900">
                智慧旅程安排系統（Smart Day-Trip Planner）
              </h1>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                空間圈選 · OSM 地圖飲食資料庫即時搜尋 · 2-opt 順路動線 · 預算與體力防呆
              </p>
            </div>
          </div>
          <div className="text-xs text-slate-500 hidden md:block tabular-nums">
            目前資料庫：{allPois.filter((p) => p.city === config.city).length} 筆（含地圖即時同步 {livePois.filter((p) => p.city === config.city).length} 筆）
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Sidebar: Filters */}
        <aside className="lg:col-span-4 xl:col-span-3">
          <FilterSidebar
            config={config}
            eligibleCount={eligibleCount}
            onChange={setConfig}
            onGenerate={() => handleGenerate()}
          />
        </aside>

        {/* Right Area: Live Map Search + Map + Timeline */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-4">
          {/* 地圖飲食／景點搜尋列 */}
          <section className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm space-y-2.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleFetchLiveMapDb(searchQuery);
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  data-testid="map-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜尋地圖上的餐廳、小吃、咖啡廳（如：牛肉麵、拉麵、火鍋、咖啡）..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                data-testid="map-search-btn"
                disabled={isFetchingMap}
                className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                {isFetchingMap ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                搜尋地圖資料庫
              </button>
              <button
                type="button"
                data-testid="sync-map-food-btn"
                disabled={isFetchingMap}
                onClick={() => handleFetchLiveMapDb()}
                className="px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" />
                撈取圈選區全部飲食
              </button>
            </form>

            {mapDbStatus && (
              <p className="text-[11px] text-blue-700 bg-blue-50/70 border border-blue-100 rounded-lg px-2.5 py-1.5">
                {mapDbStatus}
              </p>
            )}

            {/* 搜尋結果即時清單 */}
            {searchQuery.trim() !== '' && (
              <div
                data-testid="search-results"
                className="max-h-44 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg"
              >
                {searchResults.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500 text-center">
                    本機尚無「{searchQuery}」結果，請點擊「搜尋地圖資料庫」即時從 OpenStreetMap 撈取！
                  </div>
                ) : (
                  searchResults.map((poi) => {
                    const isLocked = config.lockedPoiIds.includes(poi.id);
                    return (
                      <div
                        key={poi.id}
                        className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => setFocusedPoiId(poi.id)}
                          className="text-left flex-1 min-w-0"
                        >
                          <div className="font-semibold text-slate-900 truncate">
                            {poi.name}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {poi.district} · {poi.highlight}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleLock(poi.id)}
                          className={`px-2 py-1 rounded border text-[11px] font-medium shrink-0 flex items-center gap-1 ${
                            isLocked
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-slate-200 text-slate-700 hover:border-blue-400'
                          }`}
                        >
                          <Pin className="w-3 h-3" />
                          {isLocked ? '已設必去' : '加入必去'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </section>

          <MapWorkspace
            config={config}
            allPois={allPois}
            plan={plan}
            focusedPoiId={focusedPoiId}
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
            onToggleRainyPlanB={handleToggleRainyPlanB}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
