import { useMemo, useState } from 'react';
import { Map } from 'lucide-react';
import { FilterSidebar } from './components/FilterSidebar';
import { ItineraryTimeline } from './components/ItineraryTimeline';
import { MapWorkspace } from './components/MapWorkspace';
import { POIS } from './data/pois';
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
  const [plan, setPlan] = useState(() => generateDayPlan(POIS, INITIAL_CONFIG));
  const [focusedPoiId, setFocusedPoiId] = useState<string | null>(null);

  const eligibleCount = useMemo(
    () => filterEligiblePois(POIS, config).length,
    [config]
  );

  const handleGenerate = () => {
    const cleaned: PlannerConfig = {
      ...config,
      excludedPoiIds: [],
      rainySwaps: {},
    };
    setConfig(cleaned);
    setPlan(generateDayPlan(POIS, cleaned));
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
    setPlan(generateDayPlan(POIS, nextConfig));
  };

  const handleRerollStop = (index: number) => {
    const { nextConfig, nextPlan } = rerollSingleStop(
      plan,
      index,
      POIS,
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
      // Fallback: nearest indoor POI in same city
      const indoor = POIS.find(
        (p) => p.city === originalPoi.city && p.isIndoor && p.id !== originalPoi.id
      );
      if (indoor) nextSwaps[originalPoi.id] = indoor.id;
    }
    const nextConfig: PlannerConfig = {
      ...config,
      rainySwaps: nextSwaps,
    };
    setConfig(nextConfig);
    setPlan(generateDayPlan(POIS, nextConfig));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Map className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-slate-900">
                智慧旅程安排系統（Smart Day-Trip Planner）
              </h1>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                空間圈選 · 2-opt 順路動線 · 用餐對齊 · 體力與預算防呆 · 一鍵 Google Maps 導航
              </p>
            </div>
          </div>
          <div className="text-xs text-slate-500 hidden md:block">
            內建 {POIS.length} 筆台中／台北真實感景點與美食
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
            onGenerate={handleGenerate}
          />
        </aside>

        {/* Right Area: Map + Timeline */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-5">
          <MapWorkspace
            config={config}
            allPois={POIS}
            plan={plan}
            focusedPoiId={focusedPoiId}
            onUpdateConfig={setConfig}
            onSelectPoi={(id) => setFocusedPoiId(id)}
          />

          <ItineraryTimeline
            plan={plan}
            config={config}
            allPois={POIS}
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
