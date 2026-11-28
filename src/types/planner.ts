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
  placeId?: string;             // Google Places ID (for direct review/map link)
  city: string;
  district: string;
  name: string;
  lat: number;
  lng: number;
  categories: CategoryId[];
  suggestedMinutes: number;     // 標準建議停留分鐘數
  avgCostNtd: number;           // 平均消費／門票（NT$）
  openMinutes: number;          // 每日營業開始（自 00:00 起算分鐘數）
  closeMinutes: number;         // 每日營業結束
  closedDays: number[];         // 公休日（0=週日 .. 6=週六）
  isIndoor: boolean;            // 室內／戶外屬性
  rating?: number;              // Google Places 星等
  reviewCount?: number;         // Google Places 評論數
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
      maxDistanceKm: number;        // 第一踩點最遠距離 (5 - 120 km)
      intraZoneDistanceKm: number;  // 景點間單趟移動上限 (3 - 30 km)
    };

export type PaceMode = 'relaxed' | 'balanced' | 'packed';
export type BudgetTendency = 'saver' | 'balanced' | 'foodie';
export type TransportMode = 'drive' | 'scooter' | 'transit' | 'walk';

export interface PlannerConfig {
  city: string;
  geoFilter: GeoFilter;
  selectedCategories: CategoryId[];
  minRating: number;            // 0 | 3.8 | 4.0 | 4.2 | 4.5 (default 4.0)
  minReviews: number;           // 0 | 50 | 200 | 500 (default 50)
  startMinutes: number;         // e.g. 600 (10:00)
  endMinutes: number;           // e.g. 1200 (20:00)
  pace: PaceMode;
  transportMode: TransportMode;
  budgetNtd: number;
  budgetTendency: BudgetTendency;
  dayOfWeek: number;            // 0-6
  lockedPoiIds: string[];
  excludedPoiIds: string[];
  rainySwaps: Record<string, string>; // originalPoiId -> backupPoiId
  stayOverrides?: Record<string, number>; // poiId -> custom stay minutes
}

export interface TransitLeg {
  distanceKm: number;           // 直線距離 * 1.3 迂迴係數（或 OSRM 真實路網距離）
  durationMinutes: number;      // 依交通方式計算之移動時間（或 OSRM 真實路程時間）
  estimatedCostNtd: number;     // 預估交通／油資／停車費
  modeLabel: '開車' | '騎車' | '大眾運輸' | '步行';
  costLabel: string;
  isLongWalk?: boolean;         // 步行超過 1.5 km 提醒
  isOsrm?: boolean;             // 是否為 OSRM 路網真實估算
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
  autoRainyBackupPoi?: POI;     // 自動配對 3 km 內最近室內備案
}

export interface DayPlan {
  stops: ScheduledStop[];
  outboundLeg?: TransitLeg;     // 出發點 -> 第 1 站去程遠征段
  returnLeg?: TransitLeg;       // 最後一站 -> 返回出發點回程段
  returnArrivalMinutes?: number; // 預計返抵出發點時間（分鐘）
  routeGeometry?: [number, number][]; // OSRM 沿路折線 [lat, lng][]
  isOsrmRouted?: boolean;       // 本次路線是否成功套用 OSRM 路網
  eligibleCount: number;
  totalTicketAndActivityCost: number; // 門票體驗
  totalFoodCost: number;              // 餐飲咖啡
  totalShopCost: number;              // 購物伴手禮
  totalTransitCost: number;           // 交通停車
  totalCostNtd: number;
  totalDistanceKm: number;
  isOverBudget: boolean;
  warnings: string[];
}
