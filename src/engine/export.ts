import type { DayPlan, PlannerConfig, ScheduledStop } from '../types/planner';
import { formatMinutes } from './scheduler';

export function buildGoogleMapsDirUrl(stops: ScheduledStop[]): string {
  if (stops.length === 0) return '';
  if (stops.length === 1) {
    const p = stops[0].poi;
    return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  }
  const origin = `${stops[0].poi.lat},${stops[0].poi.lng}`;
  const destination = `${stops[stops.length - 1].poi.lat},${stops[stops.length - 1].poi.lng}`;
  const waypoints = stops
    .slice(1, -1)
    .map((s) => `${s.poi.lat},${s.poi.lng}`)
    .join('|');

  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
  });
  if (waypoints) {
    params.set('waypoints', waypoints);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function buildMarkdownItinerary(plan: DayPlan, config: PlannerConfig): string {
  const cityLabel = config.city === 'taichung' ? '台中' : '台北';
  const lines: string[] = [
    `# 🗺️ ${cityLabel}一日智慧行程規劃`,
    `> 出發時間：${formatMinutes(config.startMinutes)} ｜ 預估總花費：NT$ ${plan.totalCostNtd.toLocaleString()} / 預算 NT$ ${config.budgetNtd.toLocaleString()}`,
    '',
  ];

  plan.stops.forEach((s, idx) => {
    if (s.transitFromPrev) {
      lines.push(
        `  ↳ ${s.transitFromPrev.modeLabel} 約 ${s.transitFromPrev.durationMinutes} 分鐘（${s.transitFromPrev.distanceKm} km${s.transitFromPrev.estimatedCostNtd > 0 ? ` · NT$ ${s.transitFromPrev.estimatedCostNtd}` : ''}）`
      );
    }
    const costStr = s.poi.avgCostNtd > 0 ? `NT$ ${s.poi.avgCostNtd}` : '免費';
    lines.push(
      `**${idx + 1}. [${formatMinutes(s.arrivalMinutes)}–${formatMinutes(s.departureMinutes)}] ${s.poi.name}**（${s.poi.district} · ${costStr}）`
    );
    lines.push(`   ${s.poi.highlight}`);
  });

  return lines.join('\n');
}

export function buildIcsContent(plan: DayPlan): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${y}${m}${d}`;

  const toIcsTime = (mins: number) => {
    const hh = String(Math.floor(mins / 60) % 24).padStart(2, '0');
    const mm = String(Math.round(mins % 60)).padStart(2, '0');
    return `${datePrefix}T${hh}${mm}00`;
  };

  const events = plan.stops.map((s, idx) => {
    return [
      'BEGIN:VEVENT',
      `UID:smart-trip-${idx}-${s.poi.id}@planner.local`,
      `DTSTART:${toIcsTime(s.arrivalMinutes)}`,
      `DTEND:${toIcsTime(s.departureMinutes)}`,
      `SUMMARY:${idx + 1}. ${s.poi.name}`,
      `DESCRIPTION:${s.poi.highlight}（預估花費 NT$ ${s.poi.avgCostNtd}）`,
      `GEO:${s.poi.lat};${s.poi.lng}`,
      'END:VEVENT',
    ].join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Smart Day-Trip Planner//ZH-TW',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

export interface SharedTripPayload {
  city: string;
  geoFilter: PlannerConfig['geoFilter'];
  transportMode: PlannerConfig['transportMode'];
  startMinutes: number;
  endMinutes: number;
  budgetNtd: number;
  stopIds: string[];
  stayOverrides?: Record<string, number>;
}

export function encodeTripToHash(config: PlannerConfig, plan: DayPlan): string {
  const payload: SharedTripPayload = {
    city: config.city,
    geoFilter: config.geoFilter,
    transportMode: config.transportMode,
    startMinutes: config.startMinutes,
    endMinutes: config.endMinutes,
    budgetNtd: config.budgetNtd,
    stopIds: plan.stops.map((s) => s.poi.id),
    stayOverrides: config.stayOverrides,
  };
  const json = JSON.stringify(payload);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  return `#trip=${encoded}`;
}

export function decodeTripFromHash(hash: string): SharedTripPayload | null {
  try {
    if (!hash.startsWith('#trip=')) return null;
    const encoded = hash.slice(6);
    const json = decodeURIComponent(escape(atob(encoded)));
    const parsed = JSON.parse(json) as SharedTripPayload;
    if (!parsed || !Array.isArray(parsed.stopIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}
