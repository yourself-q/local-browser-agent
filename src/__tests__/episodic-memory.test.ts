/**
 * Tests for EpisodicMemory changes:
 *   1. imageBase64 persists through addTurn → getHistory round-trip
 *   2. page_facts table and methods are gone (dead code removed)
 *   3. Existing DB without image_base64 column is migrated transparently
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { EpisodicMemory } from '../memory/episodic.js';

const TEST_DIR = join(tmpdir(), 'browser-agent-episodic-test-' + Date.now());

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

function dbPath(name = 'test.db'): string {
  return join(TEST_DIR, name);
}

// ─── imageBase64 persistence ──────────────────────────────────────────────────

describe('EpisodicMemory — imageBase64 persistence', () => {
  it('persists imageBase64 through addTurn → getHistory round-trip', () => {
    const mem = new EpisodicMemory(dbPath());
    const b64 = 'aGVsbG8='; // base64("hello")

    mem.addTurn('session-1', {
      role: 'user',
      content: '[Screenshot captured]',
      imageBase64: b64,
      stepIndex: 3,
      timestamp: 1000,
    });

    const history = mem.getHistory('session-1', 20);
    expect(history).toHaveLength(1);
    expect(history[0]!.imageBase64).toBe(b64);
    mem.close();
  });

  it('returns imageBase64: undefined for turns that had no image', () => {
    const mem = new EpisodicMemory(dbPath());

    mem.addTurn('session-1', {
      role: 'user',
      content: 'plain text turn',
      stepIndex: 0,
      timestamp: 1000,
    });

    const history = mem.getHistory('session-1', 20);
    expect(history[0]!.imageBase64).toBeUndefined();
    mem.close();
  });

  it('preserves imageBase64 across multiple turns in correct order', () => {
    const mem = new EpisodicMemory(dbPath());

    mem.addTurn('session-1', { role: 'user', content: 'step 0', stepIndex: 0, timestamp: 1 });
    mem.addTurn('session-1', { role: 'assistant', content: '{"action":"screenshot"}', stepIndex: 0, timestamp: 2 });
    mem.addTurn('session-1', { role: 'user', content: '[Screenshot captured]', imageBase64: 'abc123', stepIndex: 0, timestamp: 3 });
    mem.addTurn('session-1', { role: 'user', content: 'step 1', stepIndex: 1, timestamp: 4 });

    const history = mem.getHistory('session-1', 20);
    expect(history).toHaveLength(4);
    expect(history[0]!.imageBase64).toBeUndefined();
    expect(history[1]!.imageBase64).toBeUndefined();
    expect(history[2]!.imageBase64).toBe('abc123');
    expect(history[3]!.imageBase64).toBeUndefined();
    mem.close();
  });
});

// ─── Backward-compatible migration ────────────────────────────────────────────

describe('EpisodicMemory — DB migration', () => {
  it('adds image_base64 column to an existing DB that lacks it', () => {
    const path = dbPath('legacy.db');

    // Create a DB that looks like the old schema (no image_base64 column)
    const legacyDb = new Database(path);
    legacyDb.exec(`
      CREATE TABLE conversation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      INSERT INTO conversation (session_id, step_index, role, content, timestamp)
      VALUES ('s1', 0, 'user', 'legacy turn', 999);
    `);
    legacyDb.close();

    // EpisodicMemory should migrate it without throwing
    const mem = new EpisodicMemory(path);

    // Legacy row should be readable — image_base64 comes back as undefined
    const history = mem.getHistory('s1', 20);
    expect(history).toHaveLength(1);
    expect(history[0]!.content).toBe('legacy turn');
    expect(history[0]!.imageBase64).toBeUndefined();

    // New turns with imageBase64 should persist correctly
    mem.addTurn('s1', { role: 'user', content: '[Screenshot]', imageBase64: 'xyz', stepIndex: 1, timestamp: 1000 });
    const updated = mem.getHistory('s1', 20);
    expect(updated[1]!.imageBase64).toBe('xyz');

    mem.close();
  });

  it('is idempotent — opening the same migrated DB twice does not throw', () => {
    const path = dbPath('migrated.db');
    const mem1 = new EpisodicMemory(path);
    mem1.close();
    // Second open triggers the ALTER TABLE path again — should catch and ignore
    expect(() => {
      const mem2 = new EpisodicMemory(path);
      mem2.close();
    }).not.toThrow();
  });
});

// ─── page_facts removed ───────────────────────────────────────────────────────

describe('EpisodicMemory — page_facts removed', () => {
  it('does not create a page_facts table', () => {
    const path = dbPath('no-facts.db');
    const mem = new EpisodicMemory(path);
    mem.close();

    const db = new Database(path);
    const tables = (db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as Array<{ name: string }>)
      .map((r) => r.name);
    db.close();

    expect(tables).not.toContain('page_facts');
  });

  it('does not expose addPageFact or getPageFacts methods', () => {
    const mem = new EpisodicMemory(dbPath());
    expect((mem as unknown as Record<string, unknown>)['addPageFact']).toBeUndefined();
    expect((mem as unknown as Record<string, unknown>)['getPageFacts']).toBeUndefined();
    mem.close();
  });
});
