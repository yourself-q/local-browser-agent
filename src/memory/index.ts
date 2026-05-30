import { WorkingMemory } from './working.js';
import { EpisodicMemory } from './episodic.js';
import type { ConversationTurn } from '../llm/types.js';
import type { BrowserState } from '../state/types.js';
import type { ActionDecision } from '../llm/types.js';
import type { ExecutionResult } from '../tools/types.js';

export { WorkingMemory } from './working.js';
export { EpisodicMemory } from './episodic.js';

// ─── Memory manager facade ────────────────────────────────────────────────────

/**
 * Facade over working + episodic memory.
 * Never mixes them — they serve different purposes.
 */
export class MemoryManager {
  readonly working: WorkingMemory;
  readonly episodic: EpisodicMemory;

  constructor(private readonly sessionId: string, dbPath: string) {
    this.working = new WorkingMemory();
    this.episodic = new EpisodicMemory(dbPath);
  }

  record(decision: ActionDecision, result: ExecutionResult, state: BrowserState): void {
    this.working.update(decision, result, state);
  }

  addConversationTurn(turn: ConversationTurn): void {
    this.episodic.addTurn(this.sessionId, turn);
  }

  getConversationHistory(maxTurns = 20): ConversationTurn[] {
    return this.episodic.getHistory(this.sessionId, maxTurns);
  }

  /** Compact context for LLM — combines recent actions + task notes */
  buildContext(url: string): string {
    const notes = this.episodic.getNotes(this.sessionId);
    const facts = this.episodic.getPageFacts(this.sessionId, url);
    const recentActions = this.working.buildRecentActionsContext();

    const parts: string[] = [`## Recent Actions\n${recentActions}`];

    if (notes.length > 0) {
      parts.push(`## Task Notes\n${notes.join('\n')}`);
    }

    if (facts.length > 0) {
      parts.push(`## Page Facts for ${url}\n${facts.join('\n')}`);
    }

    return parts.join('\n\n');
  }

  dispose(): void {
    this.episodic.close();
  }
}
