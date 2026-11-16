export type CategoryId =
  | 'nature'    // 自然景觀
  | 'food'      // 在地美食／小吃
  | 'cafe'      // 特色咖啡廳
  | 'art'       // 藝文展館／室內
  | 'family'    // 親子休閒
  | 'shop'      // 購物／市集
  | 'heritage'; // 歷史古蹟

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  color: string;
  bgClass: string;
  textClass: string;
}

export interface POI {
  id: string;
  city: 'taichung' | 'taipei';
  district: string;
  name: string;
  lat: number;
  lng: number;
  categories: CategoryId[];
  suggestedMinutes: number;     // 標準建議停留分鐘數
  avgCostNtd: number;           // 平均消費／門票（NT$）
  openMinutes: number;          // 每日營業開始（自 00:00 起算分鐘數，如 540 = 09:00）
  closeMinutes: number;         // 每日營業結束（如 1260 = 21:00）
  closedDays: number[];         // 公休日（0=週日, 1=週一 ... 6=週六）
  isIndoor: boolean;            // 室內／戶外屬性（體力防呆與雨天備案）
  highlight: string;            // 一句話亮點
  rainyBackupId?: string;       // 推薦的鄰近室內雨天備案 POI ID
}

export type GeoFilter =
  | {
      mode: 'polygon';
      coordinates: [number, number][]; // [lng, lat] closed ring for turf.js
    }
  | {
      mode: 'radius';
      center: { lat: number; lng: number };
      maxDistanceKm: number;
    };

export type PaceMode = 'relaxed' | 'balanced' | 'packed';
export type BudgetTendency = 'saver' | 'balanced' | 'foodie';

export interface PlannerConfig {
  city: 'taichung' | 'taipei';
  geoFilter: GeoFilter;
  selectedCategories: CategoryId[];
  startMinutes: number;         // e.g. 600 (10:00)
  endMinutes: number;           // e.g. 1200 (20:00)
  pace: PaceMode;
  budgetNtd: number;
  budgetTendency: BudgetTendency;
  dayOfWeek: number;            // 0-6
  lockedPoiIds: string[];
  excludedPoiIds: string[];
  rainySwaps: Record<string, string>; // originalPoiId -> backupPoiId
}

export interface TransitLeg {
  distanceKm: number;           // 直線距離 * 1.3 迂迴係數
  durationMinutes: number;      // 車程 + 15 分鐘停車／步行緩衝 (若非步行)
  estimatedCostNtd: number;
  modeLabel: '步行' | '大眾運輸 / 騎車' | '開車 / 計程車';
}

export interface ScheduledStop {
  poi: POI;
  arrivalMinutes: number;
  departureMinutes: number;
  stayMinutes: number;
  transitFromPrev?: TransitLeg;
  isLocked: boolean;
  isMealSlot: boolean;
  isPlaceholderMeal?: boolean;
  activeRainyPlanB?: boolean;
  originalOutdoorPoi?: POI;
}

export interface DayPlan {
  stops: ScheduledStop[];
  eligibleCount: number;
  totalTicketAndActivityCost: number;
  totalFoodCost: number;
  totalTransitCost: number;
  totalCostNtd: number;
  totalDistanceKm: number;
  isOverBudget: boolean;
  warnings: string[];
}
