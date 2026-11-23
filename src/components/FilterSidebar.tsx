import React from 'react';
import {
  Bike,
  Bus,
  Car,
  Clock,
  Compass,
  DollarSign,
  Footprints,
  Loader2,
  Pin,
  Search,
  Sparkles,
  Tag,
} from 'lucide-react';
import { CATEGORY_METAS } from '../data/pois';
import type {
  BudgetTendency,
  CategoryId,
  PaceMode,
  PlannerConfig,
  POI,
  TransportMode,
} from '../types/planner';
import { formatMinutes } from '../engine/scheduler';

interface FilterSidebarProps {
  config: PlannerConfig;
  eligibleCount: number;
  searchQuery: string;
  searchResults: POI[];
  isFetchingMap: boolean;
  mapDbStatus: string | null;
  onSearchQueryChange: (q: string) => void;
  onSearchSubmit: (keyword?: string) => void;
  onFocusPoi: (poiId: string) => void;
  onToggleLock: (poiId: string) => void;
  onCityPreset: (city: 'taichung' | 'taipei') => void;
  onChange: (updater: (prev: PlannerConfig) => PlannerConfig) => void;
  onTransportChange: (mode: TransportMode) => void;
  onGenerate: () => void;
}

const TIME_OPTIONS = Array.from({ length: 17 }, (_, i) => (7 + i) * 60); // 07:00 - 23:00
const WEEKDAYS = [
  { value: 0, label: '週日' },
  { value: 1, label: '週一' },
  { value: 2, label: '週二' },
  { value: 3, label: '週三' },
  { value: 4, label: '週四' },
  { value: 5, label: '週五' },
  { value: 6, label: '週六' },
];

const TRANSPORT_OPTIONS: Array<{
  id: TransportMode;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'drive', label: '開車', icon: <Car className="w-3.5 h-3.5" /> },
  { id: 'scooter', label: '騎車', icon: <Bike className="w-3.5 h-3.5" /> },
  { id: 'transit', label: '大眾運輸', icon: <Bus className="w-3.5 h-3.5" /> },
  { id: 'walk', label: '步行', icon: <Footprints className="w-3.5 h-3.5" /> },
];

export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  config,
  eligibleCount,
  searchQuery,
  searchResults,
  isFetchingMap,
  mapDbStatus,
  onSearchQueryChange,
  onSearchSubmit,
  onFocusPoi,
  onToggleLock,
  onCityPreset,
  onChange,
  onTransportChange,
  onGenerate,
}) => {
  const totalHours = Math.max(1, (config.endMinutes - config.startMinutes) / 60);

  const toggleCategory = (id: CategoryId) => {
    onChange((prev) => {
      const exists = prev.selectedCategories.includes(id);
      const next = exists
        ? prev.selectedCategories.filter((c) => c !== id)
        : [...prev.selectedCategories, id];
      return { ...prev, selectedCategories: next, excludedPoiIds: [] };
    });
  };

  return (
    <div className="space-y-4">
      {/* 1. 空間圈選與雙層距離控制 + 關鍵字搜尋 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-blue-600" />
            1. 空間範圍與距離
          </h2>
          <span
            data-testid="eligible-count"
            className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200"
          >
            {eligibleCount} 個符合景點
          </span>
        </div>

        {/* 快速城市跳轉 */}
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-slate-100 text-xs">
          <button
            type="button"
            data-testid="city-taichung"
            onClick={() => onCityPreset('taichung')}
            className={`py-1.5 px-1 rounded-md font-medium transition text-[11px] ${
              config.city === 'taichung'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            台中（西屯／北區／海線）
          </button>
          <button
            type="button"
            data-testid="city-taipei"
            onClick={() => onCityPreset('taipei')}
            className={`py-1.5 px-1 rounded-md font-medium transition text-[11px] ${
              config.city === 'taipei'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            台北（市區／北投／淡水）
          </button>
        </div>

        {/* 雙模式切換 */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <button
            type="button"
            data-testid="mode-radius"
            onClick={() =>
              onChange((prev) => ({
                ...prev,
                geoFilter: {
                  mode: 'radius',
                  center:
                    prev.city === 'taichung'
                      ? { lat: 24.155, lng: 120.655 }
                      : { lat: 25.045, lng: 121.532 },
                  maxDistanceKm:
                    prev.geoFilter.mode === 'radius'
                      ? prev.geoFilter.maxDistanceKm
                      : 30,
                  intraZoneDistanceKm:
                    prev.geoFilter.mode === 'radius'
                      ? prev.geoFilter.intraZoneDistanceKm
                      : 10,
                },
              }))
            }
            className={`py-2 px-2.5 rounded-lg border font-medium transition ${
              config.geoFilter.mode === 'radius'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            錨點＋雙層距離
          </button>
          <button
            type="button"
            data-testid="mode-polygon"
            onClick={() =>
              onChange((prev) => {
                const c =
                  prev.city === 'taichung'
                    ? { lat: 24.155, lng: 120.655 }
                    : { lat: 25.045, lng: 121.532 };
                return {
                  ...prev,
                  geoFilter: {
                    mode: 'polygon',
                    coordinates: [
                      [c.lng - 0.035, c.lat - 0.025],
                      [c.lng + 0.035, c.lat - 0.025],
                      [c.lng + 0.035, c.lat + 0.025],
                      [c.lng - 0.035, c.lat + 0.025],
                      [c.lng - 0.035, c.lat - 0.025],
                    ],
                  },
                };
              })
            }
            className={`py-2 px-2.5 rounded-lg border font-medium transition ${
              config.geoFilter.mode === 'polygon'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            多邊形自由圈選
          </button>
        </div>

        {config.geoFilter.mode === 'radius' ? (
          <div className="space-y-3 pt-1">
            {/* 滑桿 1：第一踩點最遠距離 (5 - 120 km) */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-600 font-medium">第一踩點最遠距離</span>
                <span
                  data-testid="expedition-radius-label"
                  className="font-bold text-blue-700 tabular-nums"
                >
                  {config.geoFilter.maxDistanceKm} km
                </span>
              </div>
              <input
                data-testid="radius-slider"
                type="range"
                min={5}
                max={120}
                step={5}
                value={config.geoFilter.maxDistanceKm}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  onChange((prev) => ({
                    ...prev,
                    geoFilter:
                      prev.geoFilter.mode === 'radius'
                        ? { ...prev.geoFilter, maxDistanceKm: val }
                        : prev.geoFilter,
                  }));
                }}
                className="w-full accent-blue-600"
              />
              {/* 快速模式標籤 */}
              <div className="grid grid-cols-3 gap-1 text-[10px]">
                {[
                  { label: '就近市區 ≤15km', val: 15, active: config.geoFilter.maxDistanceKm <= 15 },
                  {
                    label: '郊區半日 20~50km',
                    val: 35,
                    active: config.geoFilter.maxDistanceKm > 15 && config.geoFilter.maxDistanceKm <= 50,
                  },
                  { label: '跨縣市 50~120km', val: 60, active: config.geoFilter.maxDistanceKm > 50 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      onChange((prev) => ({
                        ...prev,
                        geoFilter:
                          prev.geoFilter.mode === 'radius'
                            ? { ...prev.geoFilter, maxDistanceKm: preset.val }
                            : prev.geoFilter,
                      }))
                    }
                    className={`py-1 px-1 rounded border text-center transition ${
                      preset.active
                        ? 'border-blue-400 bg-blue-50 text-blue-700 font-semibold'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 滑桿 2：景點間單趟移動上限 (3 - 30 km) */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">景點間單趟移動上限</span>
                <span
                  data-testid="intrazone-radius-label"
                  className="font-semibold text-slate-800 tabular-nums"
                >
                  {config.geoFilter.intraZoneDistanceKm} km
                </span>
              </div>
              <input
                data-testid="intrazone-slider"
                type="range"
                min={3}
                max={30}
                step={1}
                value={config.geoFilter.intraZoneDistanceKm}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  onChange((prev) => ({
                    ...prev,
                    geoFilter:
                      prev.geoFilter.mode === 'radius'
                        ? { ...prev.geoFilter, intraZoneDistanceKm: val }
                        : prev.geoFilter,
                  }));
                }}
                className="w-full accent-slate-700"
              />
            </div>

            <p className="text-[11px] text-slate-500">
              <span className="hidden md:inline">
                提示：點擊右側地圖任一處即可移動出發錨點並自動載入周邊景點。
              </span>
              <span className="md:hidden">
                提示：點擊下方地圖任一處即可移動出發錨點並自動載入周邊景點。
              </span>
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2">
            已啟用多邊形模式：系統直接以您繪製的多邊形邊界作為核心遊玩區域（可使用地圖右上角工具微調頂點）。
          </p>
        )}

        {/* 整合進空間卡片的關鍵字搜尋 */}
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSearchSubmit(searchQuery);
            }}
            className="flex items-center gap-1.5"
          >
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                data-testid="map-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder="搜地圖景點、餐廳、咖啡..."
                className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              data-testid="map-search-btn"
              disabled={isFetchingMap}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              {isFetchingMap ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Search className="w-3 h-3" />
              )}
              搜尋
            </button>
          </form>

          {mapDbStatus && (
            <p
              data-testid="map-db-status"
              className="text-[11px] text-blue-700 bg-blue-50/80 border border-blue-100 rounded-lg px-2 py-1 leading-snug"
            >
              {mapDbStatus}
            </p>
          )}

          {searchQuery.trim() !== '' && (
            <div
              data-testid="search-results"
              className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg"
            >
              {searchResults.length === 0 ? (
                <div className="p-2.5 text-[11px] text-slate-500 text-center">
                  無快取結果，按「搜尋」可即時從地圖資料庫撈取。
                </div>
              ) : (
                searchResults.map((poi) => {
                  const isLocked = config.lockedPoiIds.includes(poi.id);
                  return (
                    <div
                      key={poi.id}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-slate-50 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => onFocusPoi(poi.id)}
                        className="text-left flex-1 min-w-0"
                      >
                        <div className="font-semibold text-slate-900 truncate text-[11px]">
                          {poi.name}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {poi.district}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleLock(poi.id)}
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-medium shrink-0 flex items-center gap-0.5 ${
                          isLocked
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-slate-200 text-slate-700 hover:border-blue-400'
                        }`}
                      >
                        <Pin className="w-2.5 h-2.5" />
                        {isLocked ? '必去' : '加入'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </section>

      {/* 2. 景點類型複選 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-blue-600" />
            2. 景點類型（可複選）
          </h2>
          <button
            type="button"
            onClick={() =>
              onChange((prev) => ({
                ...prev,
                selectedCategories:
                  prev.selectedCategories.length === CATEGORY_METAS.length
                    ? []
                    : CATEGORY_METAS.map((c) => c.id),
              }))
            }
            className="text-xs text-blue-600 hover:underline"
          >
            全選 / 清除
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_METAS.map((cat) => {
            const active = config.selectedCategories.includes(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                data-testid={`cat-${cat.id}`}
                onClick={() => toggleCategory(cat.id)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition ${
                  active
                    ? `${cat.bgClass} shadow-xs`
                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. 時間、節奏與交通方式 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            3. 時間、節奏與交通方式
          </h2>
          <span className="text-xs font-semibold text-slate-700 tabular-nums">
            共 {totalHours.toFixed(0)} 小時
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <label className="block text-slate-500 mb-1">出發時間</label>
            <select
              data-testid="start-time"
              value={config.startMinutes}
              onChange={(e) => {
                const start = Number(e.target.value);
                onChange((prev) => ({
                  ...prev,
                  startMinutes: start,
                  endMinutes: Math.max(prev.endMinutes, start + 180),
                }));
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
            >
              {TIME_OPTIONS.slice(0, -3).map((m) => (
                <option key={m} value={m}>
                  {formatMinutes(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-slate-500 mb-1">結束時間</label>
            <select
              data-testid="end-time"
              value={config.endMinutes}
              onChange={(e) =>
                onChange((prev) => ({
                  ...prev,
                  endMinutes: Math.max(prev.startMinutes + 120, Number(e.target.value)),
                }))
              }
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
            >
              {TIME_OPTIONS.filter((m) => m > config.startMinutes + 120).map((m) => (
                <option key={m} value={m}>
                  {formatMinutes(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-slate-500 mb-1">出發星期</label>
            <select
              value={config.dayOfWeek}
              onChange={(e) =>
                onChange((prev) => ({ ...prev, dayOfWeek: Number(e.target.value) }))
              }
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
            >
              {WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 交通方式選擇器 */}
        <div className="space-y-1.5">
          <div className="text-[11px] text-slate-500">主要交通工具</div>
          <div className="grid grid-cols-4 gap-1.5 text-xs">
            {TRANSPORT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`transport-${opt.id}`}
                onClick={() => onTransportChange(opt.id)}
                className={`py-1.5 px-1 rounded-lg border font-medium flex flex-col items-center gap-0.5 transition cursor-pointer ${
                  config.transportMode === opt.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {opt.icon}
                <span className="text-[11px]">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-xs">
          {(
            [
              { id: 'relaxed', label: '悠閒慢活', sub: '90-120分' },
              { id: 'balanced', label: '標準適中', sub: '60-90分' },
              { id: 'packed', label: '精實踩點', sub: '45-60分' },
            ] as { id: PaceMode; label: string; sub: string }[]
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange((prev) => ({ ...prev, pace: p.id }))}
              className={`p-2 rounded-lg border text-center transition ${
                config.pace === p.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div>{p.label}</div>
              <div className="text-[10px] opacity-75">{p.sub}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 4. 預算金額與傾向 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-blue-600" />
            4. 預算與消費傾向
          </h2>
          <span className="text-xs font-bold text-slate-800 tabular-nums">
            NT$ {config.budgetNtd.toLocaleString()}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <input
            data-testid="budget-slider"
            type="range"
            min={300}
            max={5000}
            step={100}
            value={config.budgetNtd}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, budgetNtd: Number(e.target.value) }))
            }
            className="flex-1 accent-blue-600"
          />
          <input
            data-testid="budget-input"
            type="number"
            min={100}
            max={20000}
            step={100}
            value={config.budgetNtd}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                budgetNtd: Math.max(0, Number(e.target.value)),
              }))
            }
            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs text-right tabular-nums"
          />
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-xs">
          {(
            [
              { id: 'saver', label: '省錢小資' },
              { id: 'balanced', label: '均衡體驗' },
              { id: 'foodie', label: '美食優先' },
            ] as { id: BudgetTendency; label: string }[]
          ).map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onChange((prev) => ({ ...prev, budgetTendency: b.id }))}
              className={`py-1.5 rounded-lg border font-medium transition ${
                config.budgetTendency === b.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </section>

      {/* 生成 CTA */}
      <button
        type="button"
        data-testid="generate-btn"
        onClick={onGenerate}
        className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-sm flex items-center justify-center gap-2 transition cursor-pointer"
      >
        <Sparkles className="w-4 h-4" />
        生成整日行程
      </button>
    </div>
  );
};
