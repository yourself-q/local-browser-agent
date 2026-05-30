import type { Page } from 'playwright';
import type { ActionDecision } from '../llm/types.js';
import type { GroundedElement } from '../grounding/types.js';
import type { GroundingEngine } from '../grounding/index.js';
import type { BrowserState } from '../state/types.js';
import type { DOMSnapshot } from '../state/dom.js';
import type { ExecutionResult, ToolContext } from './types.js';
import type { SymbolicActionContext } from './symbolic/types.js';
import type { TabManager } from '../browser/tabs.js';

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
import { FindOnPageTool } from './primitives/find-on-page.js';
import { WaitForHumanTool } from './primitives/wait-for-human.js';

// Symbolic
import { SubmitFormAction } from './symbolic/submit-form.js';
import { CloseModalAction } from './symbolic/close-modal.js';

// Custom tools
import type { CustomTool } from './custom.js';
import { renderJsTemplate } from './custom.js';

export type { ExecutionResult, ToolContext } from './types.js';

// ─── Tool executor ────────────────────────────────────────────────────────────

export class ToolExecutorRegistry {
  constructor(private readonly customTools: CustomTool[] = []) {}

  async execute(
    decision: ActionDecision,
    element: GroundedElement | undefined,
    page: Page,
    grounding: GroundingEngine,
    state: BrowserState,
    domSnapshot: DOMSnapshot,
    sessionId: string,
    stepIndex: number,
    tabManager: TabManager,
    captchaWaitTimeoutMs: number,
  ): Promise<ExecutionResult> {
    const ctx: ToolContext = { page, sessionId, stepIndex, captchaWaitTimeoutMs };
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

      case 'switch_tab': {
        const start = Date.now();
        try {
          const index = decision.tabIndex ?? 0;
          await tabManager.switchToTab(index);
          return { success: true, action: 'switch_tab', durationMs: Date.now() - start };
        } catch (err) {
          return { success: false, action: 'switch_tab', durationMs: Date.now() - start, error: String(err) };
        }
      }

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

      case 'close_tab': {
        const start = Date.now();
        try {
          let targetIndex = decision.tabIndex;
          if (targetIndex === undefined) {
            const tabs = await tabManager.getAllTabs();
            targetIndex = tabs.findIndex((t) => t.isActive);
            if (targetIndex < 0) targetIndex = 0;
          }
          await tabManager.closeTab(targetIndex);
          return { success: true, action: 'close_tab', durationMs: Date.now() - start };
        } catch (err) {
          return { success: false, action: 'close_tab', durationMs: Date.now() - start, error: String(err) };
        }
      }

      case 'search':
        return SearchTool.execute({ query: decision.value ?? '', count: 5 }, ctx);

      case 'find_on_page':
        return FindOnPageTool.execute({ pattern: decision.value ?? '' }, ctx);

      case 'execute_python':
        return ExecutePythonTool.execute({ code: decision.value ?? '' }, ctx);

      case 'execute_javascript':
        return JavascriptTool.execute({ code: decision.value ?? '' }, ctx);

      case 'wait_for_human':
        return WaitForHumanTool.execute(
          { reason: decision.value ?? 'Human action required', timeoutMs: ctx.captchaWaitTimeoutMs },
          ctx,
        );

      case 'custom_action': {
        const toolName = decision.customActionName;
        const tool = this.customTools.find((t) => t.name === toolName);
        if (!tool) {
          return {
            success: false,
            action: 'custom_action',
            durationMs: 0,
            error: `Unknown custom tool: "${toolName}". Available: ${this.customTools.map((t) => t.name).join(', ') || '(none)'}`,
          };
        }
        const code = renderJsTemplate(tool.jsTemplate, decision.value ?? '');
        return JavascriptTool.execute({ code }, ctx);
      }

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
