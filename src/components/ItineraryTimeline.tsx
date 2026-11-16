import React, { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  CloudRain,
  Copy,
  MapPin,
  Navigation,
  Pin,
  RefreshCw,
  Utensils,
} from 'lucide-react';
import { CATEGORY_METAS } from '../data/pois';
import {
  buildGoogleMapsDirUrl,
  buildIcsContent,
  buildMarkdownItinerary,
} from '../engine/export';
import { formatMinutes } from '../engine/scheduler';
import type { DayPlan, PlannerConfig, POI } from '../types/planner';

interface ItineraryTimelineProps {
  plan: DayPlan;
  config: PlannerConfig;
  allPois: POI[];
  focusedPoiId: string | null;
  onFocusStop: (poiId: string) => void;
  onToggleLock: (poiId: string) => void;
  onRerollStop: (index: number) => void;
  onToggleRainyPlanB: (originalPoi: POI) => void;
}

export const ItineraryTimeline: React.FC<ItineraryTimelineProps> = ({
  plan,
  config,
  allPois,
  focusedPoiId,
  onFocusStop,
  onToggleLock,
  onRerollStop,
  onToggleRainyPlanB,
}) => {
  const [copied, setCopied] = useState(false);

  const gmapsUrl = buildGoogleMapsDirUrl(plan.stops);

  const handleCopyMarkdown = async () => {
    const md = buildMarkdownItinerary(plan, config);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleDownloadIcs = () => {
    const ics = buildIcsContent(plan);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `day-trip-${config.city}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const budgetPct = Math.min(
    100,
    Math.round((plan.totalCostNtd / Math.max(1, config.budgetNtd)) * 100)
  );

  return (
    <div className="space-y-4">
      {/* KPI & 預算摘要卡片 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">智慧一日行程表</h2>
            <p className="text-xs text-slate-500">
              共 {plan.stops.length} 站 · 總移動 {plan.totalDistanceKm} km
            </p>
          </div>
          <div className="text-right">
            <div
              data-testid="total-cost"
              className={`text-base font-bold tabular-nums ${
                plan.isOverBudget ? 'text-amber-600' : 'text-slate-900'
              }`}
            >
              NT$ {plan.totalCostNtd.toLocaleString()}
              <span className="text-xs font-normal text-slate-500">
                {' '}
                / {config.budgetNtd.toLocaleString()}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              門票體驗 {plan.totalTicketAndActivityCost} · 餐飲 {plan.totalFoodCost} · 交通 {plan.totalTransitCost}
            </div>
          </div>
        </div>

        {/* 預算條 */}
        <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              plan.isOverBudget ? 'bg-amber-500' : 'bg-blue-600'
            }`}
            style={{ width: `${budgetPct}%` }}
          />
        </div>

        {/* 警告與提示橫幅 */}
        {plan.warnings.length > 0 && (
          <div className="space-y-1.5">
            {plan.warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* 出遊實用匯出列 */}
        {plan.stops.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
            <a
              data-testid="export-gmaps"
              href={gmapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-[180px] py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <Navigation className="w-3.5 h-3.5" />
              匯出 Google Maps 導航
            </a>
            <button
              type="button"
              data-testid="export-markdown"
              onClick={handleCopyMarkdown}
              className="py-2 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1.5 transition"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  已複製 LINE 文字
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  複製行程文字
                </>
              )}
            </button>
            <button
              type="button"
              data-testid="export-ics"
              onClick={handleDownloadIcs}
              className="py-2 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1.5 transition"
            >
              <Calendar className="w-3.5 h-3.5" />
              下載 .ics
            </button>
          </div>
        )}
      </div>

      {/* 時間軸卡片列表 */}
      <div className="space-y-2" data-testid="itinerary-list">
        {plan.stops.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
            目前沒有排定行程，請調整左側範圍或條件後點擊「生成整日行程」。
          </div>
        ) : (
          plan.stops.map((stop, idx) => {
            const catMeta =
              CATEGORY_METAS.find((c) => c.id === stop.poi.categories[0]) ??
              CATEGORY_METAS[0];
            const isFocused = focusedPoiId === stop.poi.id;
            const hasRainyOption =
              !stop.poi.isIndoor || stop.activeRainyPlanB;
            const backupPoi = stop.poi.rainyBackupId
              ? allPois.find((p) => p.id === stop.poi.rainyBackupId)
              : undefined;

            return (
              <React.Fragment key={`${stop.poi.id}-${idx}`}>
                {/* 站間交通連接線 */}
                {stop.transitFromPrev && (
                  <div className="flex items-center gap-2 pl-5 py-0.5 text-[11px] text-slate-500">
                    <div className="w-0.5 h-5 bg-slate-200" />
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 tabular-nums">
                      {stop.transitFromPrev.modeLabel} · 約{' '}
                      {stop.transitFromPrev.durationMinutes} 分鐘（
                      {stop.transitFromPrev.distanceKm} km
                      {stop.transitFromPrev.estimatedCostNtd > 0
                        ? ` · NT$ ${stop.transitFromPrev.estimatedCostNtd}`
                        : ''}
                      ）
                    </span>
                  </div>
                )}

                {/* 行程卡片 */}
                <div
                  data-testid={`stop-card-${idx}`}
                  onClick={() => onFocusStop(stop.poi.id)}
                  className={`rounded-xl border bg-white p-3.5 shadow-sm transition cursor-pointer ${
                    isFocused
                      ? 'border-blue-500 ring-2 ring-blue-100'
                      : 'border-slate-200 hover:border-blue-300'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* 編號圓點 */}
                    <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                      {idx + 1}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      {/* 時間與標題 */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-blue-700 tabular-nums">
                            {formatMinutes(stop.arrivalMinutes)} –{' '}
                            {formatMinutes(stop.departureMinutes)}
                          </span>
                          <span className="text-sm font-bold text-slate-900">
                            {stop.poi.name}
                          </span>
                          {stop.isMealSlot && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-semibold">
                              <Utensils className="w-2.5 h-2.5" />
                              用餐時段
                            </span>
                          )}
                          {stop.activeRainyPlanB && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[10px] font-semibold">
                              ☔ 雨天備案
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-xs">
                          <span
                            className={`px-2 py-0.5 rounded border text-[11px] font-medium ${catMeta.bgClass}`}
                          >
                            {catMeta.label}
                          </span>
                          <span className="font-semibold text-slate-700 tabular-nums">
                            {stop.poi.avgCostNtd > 0
                              ? `NT$ ${stop.poi.avgCostNtd}`
                              : '免費'}
                          </span>
                        </div>
                      </div>

                      {/* 亮點說明 */}
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {stop.poi.highlight}
                      </p>

                      {/* 底部互動列 */}
                      <div
                        className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-[11px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2 text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {stop.poi.district}
                          </span>
                          <span>· 停留 {stop.stayMinutes} 分鐘</span>
                          <span>· {stop.poi.isIndoor ? '室內' : '戶外'}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {/* 雨天備案切換 */}
                          {hasRainyOption && (backupPoi || stop.activeRainyPlanB) && (
                            <button
                              type="button"
                              onClick={() =>
                                onToggleRainyPlanB(
                                  stop.originalOutdoorPoi ?? stop.poi
                                )
                              }
                              className={`px-2 py-1 rounded-md border flex items-center gap-1 transition ${
                                stop.activeRainyPlanB
                                  ? 'border-sky-400 bg-sky-50 text-sky-700 font-medium'
                                  : 'border-slate-200 text-slate-600 hover:bg-sky-50 hover:text-sky-700'
                              }`}
                              title={
                                stop.activeRainyPlanB
                                  ? '切回原戶外景點'
                                  : `切換室內備案：${backupPoi?.name}`
                              }
                            >
                              <CloudRain className="w-3 h-3" />
                              {stop.activeRainyPlanB
                                ? '切回原景點'
                                : '☔ 雨天室內備案'}
                            </button>
                          )}

                          {/* 鎖定圖釘 */}
                          <button
                            type="button"
                            onClick={() => onToggleLock(stop.poi.id)}
                            className={`px-2 py-1 rounded-md border flex items-center gap-1 transition ${
                              stop.isLocked
                                ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <Pin className="w-3 h-3" />
                            {stop.isLocked ? '已鎖定' : '鎖定'}
                          </button>

                          {/* 換一個 (Reroll) */}
                          <button
                            type="button"
                            data-testid={`reroll-btn-${idx}`}
                            onClick={() => onRerollStop(idx)}
                            className="px-2 py-1 rounded-md border border-slate-200 text-slate-700 hover:border-blue-400 hover:text-blue-700 flex items-center gap-1 transition"
                          >
                            <RefreshCw className="w-3 h-3" />
                            換一個
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
};
