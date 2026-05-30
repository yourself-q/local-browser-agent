import type { BrowserState } from '../state/types.js';

// ─── Action selection prompt builder ─────────────────────────────────────────

export function buildActionPrompt(
  task: string,
  state: BrowserState,
  context: string,
  stepIndex: number,
  maxSteps: number,
): string {
  const vh = state.viewportHeight;
  const inViewport = state.clickableElements.filter(
    (el) => !el.bounds || (el.bounds.y < vh && el.bounds.y + el.bounds.height > 0),
  );
  const belowFold = state.clickableElements.filter(
    (el) => el.bounds && el.bounds.y >= vh,
  );

  const clickableList = inViewport
    .map((el) => {
      const name = el.name.slice(0, 80);
      const value = el.value ? ` (value: "${el.value.slice(0, 40)}")` : '';
      const disabled = el.isDisabled ? ' [DISABLED]' : '';
      const checked = el.isChecked ? ' [checked]' : '';
      // For <select>: show options inline (mirrors reference impl a11y tree format)
      // e.g. options=[*selected="Option A", "Option B", "Option C"]
      let opts = '';
      if (el.options && el.options.length > 0) {
        const optStr = el.options
          .map((o) => `${o.selected ? '*' : ''}"${o.text.slice(0, 40)}"`)
          .join(', ');
        opts = ` options=[${optStr}]`;
      }
      return `  - [${el.refId}] ${el.role}: "${name}"${value}${opts}${checked}${disabled}`;
    })
    .join('\n') + (belowFold.length > 0 ? `\n  (+ ${belowFold.length} more elements below the fold — scroll to reveal)` : '');

  const tabList = state.tabs
    .map((t) => `  - [${t.index}]${t.isActive ? ' [ACTIVE]' : ''} ${t.title} — ${t.url}`)
    .join('\n');

  return `## Task
${task}

## Progress
Step ${stepIndex + 1} of ${maxSteps}

## Current Browser State
URL: ${state.url}
Title: ${state.title}

### Open Tabs
${tabList || '  (none)'}

### Interactive Elements (accessibility tree)
${clickableList || '  (no interactive elements found)'}

## Context
${context}

## Important Notes
- Use "extract_content" to read page text — do not scroll through content just to read it.
- Use scroll only to bring a specific element into view for interaction.

## Instruction
Choose the next action to make progress toward the task.
Respond with a JSON object as specified in the system prompt.`;
}
