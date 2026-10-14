import type { HostSnapshot } from '@sctech/profilevault-contract';

/** Parse đầu ra `Get-CimInstance Win32_VideoController | Select Name, AdapterRAM | ConvertTo-Json`. TODO(SPIKE-P6): xác minh tên trường. */
export function parseVideoControllers(json: string): HostSnapshot['gpus'] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
  const out: HostSnapshot['gpus'] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.Name === 'string' ? o.Name : typeof o.name === 'string' ? o.name : undefined;
    if (!name) continue;
    const ram = typeof o.AdapterRAM === 'number' ? o.AdapterRAM : typeof o.adapterRAM === 'number' ? o.adapterRAM : undefined;
    const gpu: HostSnapshot['gpus'][number] = { name };
    if (ram !== undefined && ram > 0) gpu.vramMb = Math.round(ram / (1024 * 1024));
    out.push(gpu);
  }
  return out;
}

/** Parse đầu ra `[System.Windows.Forms.Screen]::AllScreens | Select Primary, Bounds | ConvertTo-Json`. TODO(SPIKE-P6). */
export function parseScreens(json: string): HostSnapshot['displays'] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
  const out: HostSnapshot['displays'] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    const bounds = (o.Bounds ?? o.bounds) as Record<string, unknown> | undefined;
    const width = typeof bounds?.Width === 'number' ? bounds.Width : typeof o.Width === 'number' ? o.Width : undefined;
    const height = typeof bounds?.Height === 'number' ? bounds.Height : typeof o.Height === 'number' ? o.Height : undefined;
    if (width === undefined || height === undefined) continue;
    const d: HostSnapshot['displays'][number] = { width, height };
    if (typeof o.Primary === 'boolean') d.primary = o.Primary;
    out.push(d);
  }
  return out;
}
