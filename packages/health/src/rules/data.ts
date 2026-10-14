/** Bảng phụ trợ cho luật (SPEC-02 §6.4), nằm ở packages/health/data, có phiên bản. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf8')) as T;
}

export interface CountryLanguages {
  version: string;
  countries: Record<string, string[]>;
}
export interface GpuTiers {
  version: string;
  tiers: { tier: number; patterns: string[] }[];
}
export interface OsSignatures {
  version: string;
  voices: Record<string, string[]>;
  fonts: Record<string, string[]>;
}
export interface TimezoneCountries {
  version: string;
  zones: Record<string, string>;
}
export interface CityCoords {
  version: string;
  cities: Record<string, [number, number]>;
}

let cache: RuleData | undefined;

export interface RuleData {
  countryLanguages: CountryLanguages;
  gpuTiers: GpuTiers;
  osSignatures: OsSignatures;
  timezoneCountries: TimezoneCountries;
  cityCoords: CityCoords;
}

export function loadRuleData(): RuleData {
  cache ??= {
    countryLanguages: load<CountryLanguages>('country-languages.json'),
    gpuTiers: load<GpuTiers>('gpu-tiers.json'),
    osSignatures: load<OsSignatures>('os-signatures.json'),
    timezoneCountries: load<TimezoneCountries>('timezone-countries.json'),
    cityCoords: load<CityCoords>('city-coords.json'),
  };
  return cache;
}

/** Hạng GPU 1–4 theo tên renderer; không khớp → undefined. */
export function gpuTier(renderer: string, data: GpuTiers = loadRuleData().gpuTiers): number | undefined {
  for (const t of data.tiers) {
    for (const p of t.patterns) if (new RegExp(p, 'i').test(renderer)) return t.tier;
  }
  return undefined;
}

export function timezoneCountry(tz: string, data: TimezoneCountries = loadRuleData().timezoneCountries): string | undefined {
  return data.zones[tz];
}

export function cityCoords(country: string, city: string, data: CityCoords = loadRuleData().cityCoords): [number, number] | undefined {
  return data.cities[`${country.toUpperCase()}/${city.trim().toLowerCase()}`];
}

/** Khoảng cách Haversine (km). */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Chữ ký OS khác xuất hiện trong danh sách voices/fonts. */
export function foreignOsSignatures(items: string[], ownOs: 'windows' | 'macos' | 'linux', data: OsSignatures = loadRuleData().osSignatures, kind: 'voices' | 'fonts' = 'voices'): { os: string; hits: string[] }[] {
  const out: { os: string; hits: string[] }[] = [];
  for (const [osName, sigs] of Object.entries(data[kind])) {
    if (osName === ownOs) continue;
    const hits = items.filter((v) => sigs.some((s) => v.toLowerCase().includes(s.toLowerCase())));
    if (hits.length > 0) out.push({ os: osName, hits });
  }
  return out;
}
