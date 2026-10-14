import { execFileSync } from 'node:child_process';

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export interface Autostart { enabled(): boolean; set(enabled: boolean): void }
export function windowsAutostart(argv: string[] = [process.execPath, ...process.execArgv, process.argv[1] ?? '']): Autostart {
  const run = (args: string[]) => execFileSync('reg.exe', args, { windowsHide: true, stdio: 'pipe', encoding: 'utf8' });
  return {
    enabled() { try { run(['query', KEY, '/v', 'ProfileVault']); return true; } catch { return false; } },
    set(enabled) {
      if (enabled) run(['add', KEY, '/v', 'ProfileVault', '/t', 'REG_SZ', '/d', argv.map((arg) => `"${arg.replace(/"/g, '')}"`).join(' '), '/f']);
      else if (this.enabled()) run(['delete', KEY, '/v', 'ProfileVault', '/f']);
    },
  };
}
