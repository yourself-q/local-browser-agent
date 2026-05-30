import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfig } from '../agent/types.js';

// ─── Session metadata ─────────────────────────────────────────────────────────

export interface SessionMeta {
  sessionId: string;
  task: string;
  startedAt: number;
  endedAt?: number;
  stepsRun: number;
  status: 'running' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
  config: Omit<AgentConfig, 'lmStudioApiKey'>;
}

// ─── Session manager ──────────────────────────────────────────────────────────

export class SessionManager {
  private readonly dir: string;
  private meta!: SessionMeta;

  constructor(private readonly sessionsDir: string) {
    this.dir = sessionsDir;
  }

  /**
   * Auto-cleanup: called on every new session start.
   * - Marks stale `running` sessions (older than 1 hour) as `interrupted`.
   * - Deletes sessions older than `retentionDays` days.
   *
   * Runs synchronously and silently — a cleanup failure never blocks a new run.
   */
  private cleanup(retentionDays = 7): void {
    if (!existsSync(this.dir)) return;

    const now = Date.now();
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const zombieThresholdMs = 60 * 60 * 1000; // 1 hour — clearly not running anymore

    for (const entry of readdirSync(this.dir)) {
      const metaPath = join(this.dir, entry, 'meta.json');
      if (!existsSync(metaPath)) continue;

      let meta: SessionMeta;
      try {
        meta = JSON.parse(readFileSync(metaPath, 'utf8')) as SessionMeta;
      } catch {
        continue; // corrupt meta — skip
      }

      const age = now - meta.startedAt;

      // Delete sessions older than retention period
      if (age > retentionMs) {
        try {
          rmSync(join(this.dir, entry), { recursive: true, force: true });
        } catch {
          // Ignore — another process may have deleted it already
        }
        continue;
      }

      // Mark zombie `running` sessions as `interrupted`
      if (meta.status === 'running' && age > zombieThresholdMs) {
        try {
          writeFileSync(metaPath, JSON.stringify({ ...meta, status: 'interrupted', endedAt: meta.startedAt + zombieThresholdMs }, null, 2));
        } catch {
          // Ignore
        }
      }
    }
  }

  start(config: AgentConfig): string {
    this.cleanup();

    const sessionId = randomUUID();
    const sessionDir = join(this.dir, sessionId);
    mkdirSync(join(sessionDir, 'screenshots'), { recursive: true });

    const { lmStudioApiKey: _redacted, ...safeConfig } = config;

    this.meta = {
      sessionId,
      task: config.task,
      startedAt: Date.now(),
      stepsRun: 0,
      status: 'running',
      config: safeConfig,
    };

    writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify(this.meta, null, 2));
    return sessionId;
  }

  resume(sessionId: string): SessionMeta {
    const metaPath = join(this.dir, sessionId, 'meta.json');
    if (!existsSync(metaPath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    this.meta = JSON.parse(readFileSync(metaPath, 'utf8')) as SessionMeta;
    return this.meta;
  }

  end(sessionId: string, status: 'complete' | 'failed' | 'cancelled', stepsRun: number): void {
    this.meta = {
      ...this.meta,
      endedAt: Date.now(),
      status,
      stepsRun,
    };
    const metaPath = join(this.dir, sessionId, 'meta.json');
    writeFileSync(metaPath, JSON.stringify(this.meta, null, 2));
  }

  sessionDir(sessionId: string): string {
    return join(this.dir, sessionId);
  }

  screenshotDir(sessionId: string): string {
    return join(this.dir, sessionId, 'screenshots');
  }

  eventsPath(sessionId: string): string {
    return join(this.dir, sessionId, 'events.jsonl');
  }

  dbPath(sessionId: string): string {
    return join(this.dir, sessionId, 'memory.db');
  }

  list(): SessionMeta[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((d) => existsSync(join(this.dir, d, 'meta.json')))
      .map((d) => JSON.parse(readFileSync(join(this.dir, d, 'meta.json'), 'utf8')) as SessionMeta);
  }

  /** Generate a stable ID for the current session */
  static newId(): string {
    return randomUUID();
  }
}
