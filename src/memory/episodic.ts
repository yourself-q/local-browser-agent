import Database from 'better-sqlite3';
import type { ConversationTurn } from '../llm/types.js';

// ─── Episodic memory (Refinement 4) ──────────────────────────────────────────

/**
 * Long-term, persistent store for:
 * - Conversation history (for LLM context)
 * - Learned facts about pages/sites
 * - Session-level task notes
 *
 * Backed by SQLite (better-sqlite3 — synchronous, no async complexity).
 * Completely separate from WorkingMemory.
 */
export class EpisodicMemory {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_session ON conversation(session_id, step_index);

      CREATE TABLE IF NOT EXISTS page_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        url_pattern TEXT NOT NULL,
        fact TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        note TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `);
  }

  // ── Conversation history ───────────────────────────────────────────────────

  addTurn(sessionId: string, turn: ConversationTurn): void {
    if (!this.db.open) return; // guard against use-after-close
    this.db
      .prepare(
        `INSERT INTO conversation (session_id, step_index, role, content, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, turn.stepIndex, turn.role, turn.content, turn.timestamp);
  }

  getHistory(sessionId: string, maxTurns = 20): ConversationTurn[] {
    const rows = this.db
      .prepare(
        `SELECT step_index, role, content, timestamp
         FROM conversation
         WHERE session_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(sessionId, maxTurns) as Array<{
        step_index: number;
        role: string;
        content: string;
        timestamp: number;
      }>;

    return rows.reverse().map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
      stepIndex: r.step_index,
      timestamp: r.timestamp,
    }));
  }

  // ── Page facts ─────────────────────────────────────────────────────────────

  addPageFact(sessionId: string, urlPattern: string, fact: string, confidence = 1.0): void {
    this.db
      .prepare(
        `INSERT INTO page_facts (session_id, url_pattern, fact, confidence, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, urlPattern, fact, confidence, Date.now());
  }

  getPageFacts(sessionId: string, url: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT fact FROM page_facts
         WHERE session_id = ? AND ? LIKE '%' || url_pattern || '%'
         ORDER BY confidence DESC
         LIMIT 10`,
      )
      .all(sessionId, url) as Array<{ fact: string }>;
    return rows.map((r) => r.fact);
  }

  // ── Task notes ─────────────────────────────────────────────────────────────

  addNote(sessionId: string, stepIndex: number, note: string): void {
    this.db
      .prepare(
        `INSERT INTO task_notes (session_id, step_index, note, timestamp)
         VALUES (?, ?, ?, ?)`,
      )
      .run(sessionId, stepIndex, note, Date.now());
  }

  getNotes(sessionId: string): string[] {
    const rows = this.db
      .prepare(`SELECT note FROM task_notes WHERE session_id = ? ORDER BY id`)
      .all(sessionId) as Array<{ note: string }>;
    return rows.map((r) => r.note);
  }

  close(): void {
    this.db.close();
  }
}
