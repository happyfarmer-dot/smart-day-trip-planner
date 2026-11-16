import React from 'react';
import {
  Clock,
  Compass,
  DollarSign,
  Sparkles,
  Tag,
} from 'lucide-react';
import { CATEGORY_METAS } from '../data/pois';
import type {
  BudgetTendency,
  CategoryId,
  PaceMode,
  PlannerConfig,
} from '../types/planner';
import { formatMinutes } from '../engine/scheduler';

interface FilterSidebarProps {
  config: PlannerConfig;
  eligibleCount: number;
  onChange: (updater: (prev: PlannerConfig) => PlannerConfig) => void;
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

export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  config,
  eligibleCount,
  onChange,
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
      {/* 1. 空間圈選與距離模式 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-blue-600" />
            1. 空間範圍與距離
          </h2>
          <span
            data-testid="eligible-count"
            className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200"
          >
            {eligibleCount} 個符合景點
          </span>
        </div>

        {/* 城市切換 */}
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-slate-100 text-xs">
          <button
            type="button"
            data-testid="city-taichung"
            onClick={() =>
              onChange((prev) => ({
                ...prev,
                city: 'taichung',
                geoFilter: {
                  mode: 'radius',
                  center: { lat: 24.155, lng: 120.655 },
                  maxDistanceKm: 8,
                },
                lockedPoiIds: [],
                excludedPoiIds: [],
                rainySwaps: {},
              }))
            }
            className={`py-1.5 rounded-md font-medium transition ${
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
            onClick={() =>
              onChange((prev) => ({
                ...prev,
                city: 'taipei',
                geoFilter: {
                  mode: 'radius',
                  center: { lat: 25.045, lng: 121.532 },
                  maxDistanceKm: 8,
                },
                lockedPoiIds: [],
                excludedPoiIds: [],
                rainySwaps: {},
              }))
            }
            className={`py-1.5 rounded-md font-medium transition ${
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
                      : 8,
                },
              }))
            }
            className={`py-2 px-2.5 rounded-lg border font-medium transition ${
              config.geoFilter.mode === 'radius'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            錨點＋距離半徑
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
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-600">單趟最遠移動距離</span>
              <span className="font-semibold text-blue-700 tabular-nums">
                {config.geoFilter.maxDistanceKm} km
              </span>
            </div>
            <input
              data-testid="radius-slider"
              type="range"
              min={1}
              max={50}
              step={1}
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
            <p className="text-[11px] text-slate-500">
              提示：點擊右側地圖任一處即可移動出發錨點。
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2">
            已啟用多邊形模式：可使用地圖右上角繪圖工具繪製多邊形／矩形，或拖曳頂點微調範圍。
          </p>
        )}
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

      {/* 3. 時間與節奏 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            3. 時間與旅遊節奏
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
