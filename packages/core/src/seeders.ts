import type { Clock } from '@sctech/profilevault-contract';
import type { Database, SettingsRepo } from '@sctech/profilevault-db';
import type { Logger } from './logger.js';

export interface SeedContext {
  database: Database;
  settings: SettingsRepo;
  clock: Clock;
  logger: Logger;
}

export type Seeder = (ctx: SeedContext) => void | Promise<void>;

/**
 * Seed lần chạy đầu (SPEC-00 §11): mỗi seeder chạy đúng một lần, đánh dấu `settings['seeded.<name>']`.
 * Feature sau (003: ngưỡng, 004: luật) đăng ký seeder của mình (giả định G7).
 */
export class SeederRegistry {
  private readonly seeders = new Map<string, Seeder>();

  register(name: string, fn: Seeder): this {
    if (this.seeders.has(name)) throw new Error(`seeder trùng tên: ${name}`);
    this.seeders.set(name, fn);
    return this;
  }

  names(): string[] {
    return [...this.seeders.keys()];
  }

  /** Trả danh sách seeder đã chạy trong lần gọi này. */
  async run(ctx: SeedContext): Promise<string[]> {
    const ran: string[] = [];
    for (const [name, fn] of this.seeders) {
      const key = `seeded.${name}`;
      if (ctx.settings.get<boolean>(key) === true) continue;
      await fn(ctx);
      ctx.settings.set(key, true, 'system');
      ran.push(name);
      ctx.logger.info('seeder đã chạy', { seeder: name });
    }
    return ran;
  }
}
