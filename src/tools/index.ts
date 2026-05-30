import type { Page } from 'playwright';
import type { ActionDecision } from '../llm/types.js';
import type { GroundedElement } from '../grounding/types.js';
import type { GroundingEngine } from '../grounding/index.js';
import type { BrowserState } from '../state/types.js';
import type { DOMSnapshot } from '../state/dom.js';
import type { ExecutionResult, ToolContext } from './types.js';
import type { SymbolicActionContext } from './symbolic/types.js';

// Primitives
import { ClickTool } from './primitives/click.js';
import { TypeTool } from './primitives/type.js';
import { ScrollTool } from './primitives/scroll.js';
import { HoverTool } from './primitives/hover.js';
import { NavigateTool, GoBackTool, GoForwardTool, ReloadTool } from './primitives/navigate.js';
import { ExtractContentTool } from './primitives/extract.js';
import { ScreenshotTool } from './primitives/screenshot.js';
import { AccessibilityDumpTool } from './primitives/accessibility-dump.js';
import { DOMSnapshotTool } from './primitives/dom-snapshot.js';
import { SearchTool } from './primitives/search.js';
import { ExecutePythonTool } from './primitives/execute-python.js';
import { JavascriptTool } from './primitives/javascript.js';

// Symbolic
import { SubmitFormAction } from './symbolic/submit-form.js';
import { CloseModalAction } from './symbolic/close-modal.js';

export type { ExecutionResult, ToolContext } from './types.js';

// ─── Tool executor ────────────────────────────────────────────────────────────

export class ToolExecutorRegistry {
  async execute(
    decision: ActionDecision,
    element: GroundedElement | undefined,
    page: Page,
    grounding: GroundingEngine,
    state: BrowserState,
    domSnapshot: DOMSnapshot,
    sessionId: string,
    stepIndex: number,
  ): Promise<ExecutionResult> {
    const ctx: ToolContext = { page, sessionId, stepIndex };
    const symCtx: SymbolicActionContext = { page, grounding, state, domSnapshot, sessionId, stepIndex };

    switch (decision.action) {
      case 'click':
        return ClickTool.execute({ element, button: 'left' }, ctx);

      case 'type':
        return TypeTool.execute(
          {
            element,
            text: decision.value ?? '',
            clearFirst: true,
            pressEnterAfter: false,
          },
          ctx,
        );

      case 'scroll':
        return ScrollTool.execute(
          {
            direction: decision.scrollDirection ?? 'down',
            amount: decision.scrollAmount ?? 300,
            element,
          },
          ctx,
        );

      case 'hover':
        return HoverTool.execute({ element }, ctx);

      case 'navigate':
        return NavigateTool.execute({ url: decision.value ?? '' }, ctx);

      case 'go_back':
        return GoBackTool.execute({}, ctx);

      case 'go_forward':
        return GoForwardTool.execute({}, ctx);

      case 'reload':
        return ReloadTool.execute({}, ctx);

      case 'switch_tab':
        return {
          success: false,
          action: 'switch_tab',
          durationMs: 0,
          error: 'Use TabManager.switchToTab() for tab switching',
        };

      case 'extract_content':
        return ExtractContentTool.execute({ format: 'text' }, ctx);

      case 'screenshot':
        return ScreenshotTool.execute({}, ctx);

      case 'accessibility_dump':
        return AccessibilityDumpTool.execute({ format: 'json' }, ctx);

      case 'dom_snapshot':
        return DOMSnapshotTool.execute({}, ctx);

      case 'wait':
        await page.waitForTimeout(1000);
        return { success: true, action: 'wait', durationMs: 1000 };

      // Symbolic actions
      case 'submit_form':
        return SubmitFormAction.execute({ pressEnter: false }, symCtx);

      case 'close_modal':
        return CloseModalAction.execute({ strategy: 'auto' }, symCtx);

      case 'login_flow':
        return { success: false, action: 'login_flow', durationMs: 0, error: 'login_flow requires custom implementation' };

      case 'open_search_result':
        return ClickTool.execute({ element, button: 'left' }, ctx);

      case 'close_tab':
        // Tab close is handled at the orchestrator level via TabManager
        return { success: false, action: 'close_tab', durationMs: 0, error: 'Use TabManager.closeTab() for tab closing' };

      case 'search':
        return SearchTool.execute({ query: decision.value ?? '', count: 5 }, ctx);

      case 'execute_python':
        return ExecutePythonTool.execute({ code: decision.value ?? '' }, ctx);

      case 'execute_javascript':
        return JavascriptTool.execute({ code: decision.value ?? '' }, ctx);

      case 'done':
      case 'fail':
        return { success: true, action: decision.action, durationMs: 0 };

      default: {
        const _: never = decision.action;
        return { success: false, action: 'click', durationMs: 0, error: `Unknown action: ${String(_)}` };
      }
    }
  }
}
