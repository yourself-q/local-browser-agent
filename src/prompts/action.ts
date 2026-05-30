import type { BrowserState } from '../state/types.js';

// ─── Action selection prompt builder ─────────────────────────────────────────

export function buildActionPrompt(
  task: string,
  state: BrowserState,
  context: string,
  stepIndex: number,
  maxSteps: number,
): string {
  const clickableList = state.clickableElements
    // Reference impl shows ALL interactive elements — no name filter.
    // Unnamed textboxes (no aria-label/placeholder/label) must be visible so the LLM can type into them.
    .slice(0, 60) // 60 elements — keep context window sane
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
    .join('\n');

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
- The accessibility tree above already contains ALL interactive elements currently in the DOM.
- For static/server-rendered pages (like news sites, wikis, search results), scrolling does NOT reveal new elements in the tree. If you need to read text content that isn't captured in the element names above, use "extract_content" to get the full page text.
- Only use scroll if you genuinely need to bring an element into view to interact with it.

## Instruction
Choose the next action to make progress toward the task.
Respond with a JSON object as specified in the system prompt.`;
}
