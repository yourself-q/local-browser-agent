import Database from 'better-sqlite3';
import type { ConversationTurn } from '../llm/types.js';

// ─── Episodic memory ──────────────────────────────────────────────────────────

/**
 * Long-term, persistent store for:
 * - Conversation history (for LLM context)
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
        image_base64 TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_session ON conversation(session_id, step_index);

      CREATE TABLE IF NOT EXISTS task_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        note TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `);

    // Migrate existing DBs that were created before image_base64 was added.
    // ALTER TABLE ADD COLUMN fails if the column already exists — catch and ignore.
    try {
      this.db.exec(`ALTER TABLE conversation ADD COLUMN image_base64 TEXT`);
    } catch {
      // Column already present — nothing to do
    }
  }

  // ── Conversation history ───────────────────────────────────────────────────

  addTurn(sessionId: string, turn: ConversationTurn): void {
    if (!this.db.open) return; // guard against use-after-close
    this.db
      .prepare(
        `INSERT INTO conversation (session_id, step_index, role, content, image_base64, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, turn.stepIndex, turn.role, turn.content, turn.imageBase64 ?? null, turn.timestamp);
  }

  getHistory(sessionId: string, maxTurns = 20): ConversationTurn[] {
    const rows = this.db
      .prepare(
        `SELECT step_index, role, content, image_base64, timestamp
         FROM conversation
         WHERE session_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(sessionId, maxTurns) as Array<{
        step_index: number;
        role: string;
        content: string;
        image_base64: string | null;
        timestamp: number;
      }>;

    return rows.reverse().map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
      imageBase64: r.image_base64 ?? undefined,
      stepIndex: r.step_index,
      timestamp: r.timestamp,
    }));
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
