// ─── Action loop detector ─────────────────────────────────────────────────────

/**
 * Detects repetitive action patterns that indicate the agent is stuck.
 *
 * Tracks (action, target) pairs in a sliding window. If the same pair
 * appears THRESHOLD or more times within the window, a loop is declared.
 *
 * This catches cases consecutive-failure counting misses: actions that
 * succeed but make no progress (e.g. clicking the same button 5 times).
 */
export class ActionLoopDetector {
  private readonly history: Array<{ action: string; target: string }> = [];
  private readonly WINDOW_SIZE = 10;
  private readonly THRESHOLD = 3;

  record(action: string, target: string | undefined): void {
    this.history.push({ action, target: target ?? '' });
    if (this.history.length > this.WINDOW_SIZE) this.history.shift();
  }

  detect(): { looping: boolean; description: string } {
    if (this.history.length < this.THRESHOLD) return { looping: false, description: '' };

    const counts = new Map<string, number>();
    for (const { action, target } of this.history) {
      const key = `${action}::${target}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const top = [...counts.entries()]
      .filter(([, n]) => n >= this.THRESHOLD)
      .sort(([, a], [, b]) => b - a)[0];

    if (!top) return { looping: false, description: '' };
    const [key, count] = top;
    const colonIdx = key.indexOf('::');
    const action = key.slice(0, colonIdx);
    const target = key.slice(colonIdx + 2);
    const targetLabel = target ? ` on "${target.slice(0, 50)}"` : '';
    return {
      looping: true,
      description: `"${action}"${targetLabel} repeated ${count}× in the last ${this.history.length} steps`,
    };
  }

  reset(): void {
    this.history.length = 0;
  }
}
