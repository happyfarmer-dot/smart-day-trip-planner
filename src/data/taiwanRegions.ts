export type TaiwanRegionId = 'north' | 'central' | 'south' | 'east' | 'islands';

export interface TaiwanCityHub {
  id: string;
  name: string;
  region: TaiwanRegionId;
  lat: number;
  lng: number;
}

export const TAIWAN_REGIONS: Array<{ id: TaiwanRegionId; label: string }> = [
  { id: 'north', label: '北部' },
  { id: 'central', label: '中部' },
  { id: 'south', label: '南部' },
  { id: 'east', label: '東部' },
  { id: 'islands', label: '離島' },
];

export const TAIWAN_CITIES: TaiwanCityHub[] = [
  // 北部
  { id: 'keelung', name: '基隆市', region: 'north', lat: 25.1283, lng: 121.7419 },
  { id: 'taipei', name: '台北市', region: 'north', lat: 25.0450, lng: 121.5320 },
  { id: 'newtaipei', name: '新北市', region: 'north', lat: 25.0124, lng: 121.4657 },
  { id: 'taoyuan', name: '桃園市', region: 'north', lat: 24.9936, lng: 121.3010 },
  { id: 'hsinchu-city', name: '新竹市', region: 'north', lat: 24.8017, lng: 120.9718 },
  { id: 'hsinchu-county', name: '新竹縣', region: 'north', lat: 24.7033, lng: 121.1252 },
  // 中部
  { id: 'miaoli', name: '苗栗縣', region: 'central', lat: 24.4150, lng: 120.7720 },
  { id: 'taichung', name: '台中市', region: 'central', lat: 24.1550, lng: 120.6550 },
  { id: 'changhua', name: '彰化縣', region: 'central', lat: 24.0650, lng: 120.4950 },
  { id: 'nantou', name: '南投縣', region: 'central', lat: 23.9200, lng: 120.9300 },
  { id: 'yunlin', name: '雲林縣', region: 'central', lat: 23.7092, lng: 120.4313 },
  // 南部
  { id: 'chiayi-city', name: '嘉義市', region: 'south', lat: 23.4801, lng: 120.4491 },
  { id: 'chiayi-county', name: '嘉義縣', region: 'south', lat: 23.4589, lng: 120.2929 },
  { id: 'tainan', name: '台南市', region: 'south', lat: 22.9950, lng: 120.1950 },
  { id: 'kaohsiung', name: '高雄市', region: 'south', lat: 22.6273, lng: 120.3014 },
  { id: 'pingtung', name: '屏東縣', region: 'south', lat: 22.3500, lng: 120.5900 },
  // 東部
  { id: 'yilan', name: '宜蘭縣', region: 'east', lat: 24.7570, lng: 121.7530 },
  { id: 'hualien', name: '花蓮縣', region: 'east', lat: 23.9872, lng: 121.6016 },
  { id: 'taitung', name: '台東縣', region: 'east', lat: 22.7583, lng: 121.1444 },
  // 離島
  { id: 'penghu', name: '澎湖縣', region: 'islands', lat: 23.5695, lng: 119.5793 },
  { id: 'kinmen', name: '金門縣', region: 'islands', lat: 24.4367, lng: 118.3186 },
  { id: 'lienchiang', name: '連江縣(馬祖)', region: 'islands', lat: 26.1506, lng: 119.9296 },
];
