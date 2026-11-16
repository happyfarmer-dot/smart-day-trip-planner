import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database,
  KeyRound,
  Loader2,
  Map as MapIcon,
  Pin,
  Search,
  X,
} from 'lucide-react';
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
          p.city === config.city &&
          (p.name.toLowerCase().includes(q) ||
            p.highlight.toLowerCase().includes(q) ||
            p.district.toLowerCase().includes(q))
      )
      .slice(0, 15);
  }, [allPois, config.city, searchQuery]);

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
            ? `已從 ${sourceLabel} 載入 ${fetched.length} 筆真實景點與店家，並顯示於地圖與排程候選中。`
            : '此範圍內未找到更多符合條件的地圖資料，可試著放大範圍或換個關鍵字。'
        );
      } catch (err) {
        if (!silent) {
          setMapDbStatus(
            err instanceof Error && err.message.includes('Google')
              ? err.message
              : '即時地圖資料庫連線逾時，目前顯示內建與已快取之景點資料。'
          );
        }
      } finally {
        setIsFetchingMap(false);
      }
    },
    [gmapsKey, config.geoFilter, config.city]
  );

  // Auto-fetch live map POIs on initial load & when region/city changes
  useEffect(() => {
    const timer = setTimeout(() => {
      handleFetchLiveMapDb(undefined, true);
    }, 650);
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

  const handleSaveGmapsKey = () => {
    saveGoogleMapsApiKey(keyDraft);
    setGmapsKey(keyDraft.trim());
    setShowKeyModal(false);
    setLivePois([]);
  };

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
                自動同步地圖百大景點與飲食 · 支援 Google Maps Places API 串接
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 hidden md:inline tabular-nums">
              地圖已載入 {allPois.filter((p) => p.city === config.city).length} 個景點與店家
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
              Google Places API (New) 金鑰：
            </span>
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="貼上您的 Google Maps API Key（僅存於本機瀏覽器 localStorage）"
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
            <p className="w-full text-[11px] text-slate-500">
              未設定金鑰時，系統預設使用免費免金鑰的 OpenStreetMap 地圖資料庫自動撈取上百個真實景點、公園、古蹟與餐廳；填入您的 Google Maps API Key 後可改為即時撈取 Google Maps 評分與景點。
            </p>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Sidebar */}
        <aside className="lg:col-span-4 xl:col-span-3">
          <FilterSidebar
            config={config}
            eligibleCount={eligibleCount}
            onChange={setConfig}
            onGenerate={handleGenerate}
          />
        </aside>

        {/* Right Area */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-4">
          {/* 地圖景點／飲食即時搜尋列 */}
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
                  placeholder="搜尋地圖景點、餐廳、公園、夜市（如：牛肉麵、美術館、公園）..."
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
                同步圈選區全部景點與飲食
              </button>
            </form>

            {mapDbStatus && (
              <p className="text-[11px] text-blue-700 bg-blue-50/70 border border-blue-100 rounded-lg px-2.5 py-1.5">
                {mapDbStatus}
              </p>
            )}

            {searchQuery.trim() !== '' && (
              <div
                data-testid="search-results"
                className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg"
              >
                {searchResults.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500 text-center">
                    目前快取無「{searchQuery}」結果，請點擊「搜尋地圖資料庫」即時撈取！
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
                        <div className="flex items-center gap-1.5 shrink-0">
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${poi.lat},${poi.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 text-[11px]"
                          >
                            Google 地圖
                          </a>
                          <button
                            type="button"
                            onClick={() => handleToggleLock(poi.id)}
                            className={`px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1 ${
                              isLocked
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-slate-200 text-slate-700 hover:border-blue-400'
                            }`}
                          >
                            <Pin className="w-3 h-3" />
                            {isLocked ? '已設必去' : '加入必去'}
                          </button>
                        </div>
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
