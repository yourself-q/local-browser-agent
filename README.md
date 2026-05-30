# browser-agent

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/yourself-q/local-browser-agent)

Local-first browser agent runtime.

## Why?

Most browser agents require an OpenAI or Anthropic API key. Every page screenshot, every DOM snapshot, every decision gets sent to a third-party server — and billed.

This project is built on two principles:

- **Zero cost.** Runs entirely on local LLMs (LM Studio, Ollama, vLLM). No API key, no usage bill, no token limits imposed by someone else's pricing tier.
- **Zero data leaving your machine.** Your browsing, your credentials, your page content stay local. Nothing is sent to external services.

If you have a GPU and a local model, you have a fully functional browser agent.

---

- Attaches to your **existing Chrome session** via CDP — no sandboxed Chromium, no profile loss.
- **`data-agent-ref` grounding** — injects stable CSS attributes into every interactive element each step, resolves via exact selector before falling back to DOM fuzzy match, then vision.
- **Loop detection** — detects when the same `(action, target)` repeats 3+ times in a 10-step window and forces a strategy change.
- **Multi-action steps** — LLM can chain up to 3 follow-up actions (`nextActions`) in one step without re-capturing page state.
- **Event-sourced** — every action, state transition, and recovery written to an append-only `events.jsonl`.
- Works with **any OpenAI-compatible endpoint** — LM Studio, Ollama, vLLM, OpenRouter, OpenAI, Groq, etc.
- Exposes a **CLI**, **MCP server**, and **OpenAI-compatible HTTP API**.

---

## Architecture

```
CLI / MCP / API
     │
AgentOrchestrator
     │
Runtime Loop: capture → decide → ground → execute → verify
     │              │              │           │
  StateCapturer  LLMClient   GroundingEngine  ToolExecutor
  (A11y+DOM)  (OpenAI-compat) (ref→dom→vision) (Playwright)
     │
 BrowserManager
 connectOverCDP() → existing Chrome
```

**State capture (every step)**

1. Accessibility tree (Playwright CDP) → normalised + fingerprinted
2. DOM injection — `data-agent-ref="ref_N"` written to every interactive element
3. DOM snapshot — CSS selector index for fallback grounding

**Grounding cascade**

1. `[data-agent-ref="ref_N"]` CSS selector — exact, unambiguous (primary)
2. DOM snapshot text/aria-label fuzzy match + CSS selector
3. Vision — screenshot → LLM bounding-box prediction (last resort, budget-capped at 3/session)

---

## Requirements

- Node.js 18+
- Chrome (remote debugging enabled — see below)
- Any OpenAI-compatible LLM endpoint with a loaded model

---

## Setup

```bash
cp .env.example .env
# Edit .env — set LM_STUDIO_BASE_URL and AGENT_MODEL at minimum

npm install
```

---

## Start Chrome with Remote Debugging

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --no-first-run \
  --no-default-browser-check
```

**Shell alias (recommended):**
```bash
alias chrome-debug='/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --no-first-run'
```

Chrome must be running before starting the agent.

---

## Step 1: Diagnose

Always run this first to verify Chrome connectivity and grounding quality.

```bash
# Basic diagnostic
npx tsx src/cli/index.ts diagnose --port 9222

# Navigate to a specific URL before diagnosing
npx tsx src/cli/index.ts diagnose --port 9222 --url https://github.com

# Show the full accessibility tree
npx tsx src/cli/index.ts diagnose --port 9222 --show-tree --depth 4
```

Reports: Chrome reachability · interactive element count · nodeId stability · modal/overlay detection · grounding confidence per element · overall groundability score.

---

## Step 2: Run a Task

```bash
npx tsx src/cli/index.ts run \
  --task "Find the trending repositories on GitHub" \
  --chrome-port 9222 \
  --model "qwen3-30b-a3b"
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `--task <text>` | — | Task description (required) |
| `--session <id>` | auto | Resume or name a session |
| `--chrome-port <port>` | `9222` | Chrome debugging port |
| `--model <name>` | env `AGENT_MODEL` | Model name |
| `--max-steps <n>` | `50` | Max agent steps |
| `--approval` | off | Enable human approval mode |
| `--deterministic` | off | Force temperature=0 |
| `--sessions-dir <dir>` | `./sessions` | Session storage path |

---

## Step 3: Inspect Sessions

```bash
# List all sessions
npx tsx src/cli/index.ts list

# Stream event log for a session
npx tsx src/cli/index.ts replay --session <session-id>

# Full inspection
npx tsx src/cli/index.ts inspect --session <session-id>
```

---

## LLM Configuration

The agent uses any OpenAI-compatible chat completions endpoint.

**`.env` keys:**

```bash
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1   # Any OpenAI-compatible base URL
LM_STUDIO_API_KEY=lm-studio                    # API key (use any string for local servers)
AGENT_MODEL=qwen3-30b-a3b                      # Model name as the server expects it
AGENT_MAX_TOKENS=8192                          # Max tokens per step
STRIP_THINKING_BLOCKS=true                     # Strip <think>...</think> (Qwen3, DeepSeek)
JSON_MODE=false                                # response_format:json_object — leave false
                                               # for local models (prompt-based is more reliable)
```

**Compatible endpoints:**

| Provider | Base URL |
|---|---|
| LM Studio (default) | `http://127.0.0.1:1234/v1` |
| Ollama (OpenAI compat) | `http://localhost:11434/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |

---

## Agent Capabilities

### Actions available to the LLM

**Browser interaction:** `click` · `type` · `scroll` · `hover` · `navigate` · `go_back` · `go_forward` · `reload` · `wait` · `submit_form` · `close_modal` · `switch_tab` · `close_tab`

**Page inspection:** `screenshot` · `extract_content` · `find_on_page` · `accessibility_dump` · `dom_snapshot`

**Agent tools:** `search` (web) · `execute_python` · `execute_javascript`

**Control flow:** `done` · `fail`

### `find_on_page`

Search current page text for a keyword or regex without dumping the entire page.

```json
{"action": "find_on_page", "value": "Order number"}
{"action": "find_on_page", "value": "/\\d{4}-\\d{4}/"}
```

Returns up to 10 matches with ±120 characters of surrounding context.

### `nextActions` — multi-action chaining

The LLM can queue up to 3 follow-up actions that execute immediately after the primary action, reusing the same state snapshot (no re-capture between each).

```json
{
  "action": "click",
  "targetElementId": "ref_3",
  "nextActions": [
    {"action": "type", "targetElementId": "ref_4", "value": "hello@example.com"},
    {"action": "click", "targetElementId": "ref_8"}
  ]
}
```

Remaining follow-ups are cancelled automatically if the primary action causes a URL change.

### Loop detection

When the same `(action, target)` pair appears 3+ times within the last 10 steps, a `LOOP DETECTED` notice is injected into the LLM context, prompting a strategy change. Resets on URL navigation.

### Persistent memory (`remember`)

The LLM can persist facts across the full session by setting the `remember` field. Notes survive context window rotation and appear in every subsequent step.

```json
{"action": "type", "targetElementId": "ref_5", "value": "user@example.com",
 "remember": "Entered email user@example.com into the login form"}
```

---

## MCP Server

```bash
npx tsx src/cli/index.ts mcp
```

**Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "browser-agent": {
      "command": "npx",
      "args": ["tsx", "/path/to/browser-agent/src/cli/index.ts", "mcp"]
    }
  }
}
```

**Exposed tools:** `browser_run_task` · `browser_get_state` · `browser_list_sessions`

---

## OpenAI-Compatible HTTP API

```bash
npx tsx src/cli/index.ts serve --port 8080
```

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Go to github.com and find trending repos"}]}'
```

---

## Event Log Format

Every session writes an append-only `events.jsonl`:

```jsonl
{"id":"…","type":"session.started","stepIndex":-1,"timestamp":…,"payload":{"task":"…"}}
{"id":"…","type":"state.captured","stepIndex":0,"timestamp":…,"payload":{"url":"…","clickableElements":[…]}}
{"id":"…","type":"action.decided","stepIndex":0,"timestamp":…,"payload":{"action":"click","reasoning":"…","confidence":0.9}}
{"id":"…","type":"grounding.succeeded","stepIndex":0,"timestamp":…,"payload":{"element":{"strategy":"a11y","nodeId":"ref_3"}}}
{"id":"…","type":"action.succeeded","stepIndex":0,"timestamp":…,"payload":{"action":"click","durationMs":120}}
{"id":"…","type":"verification.passed","stepIndex":0,"timestamp":…,"payload":{"delta":{"urlChanged":true}}}
```

---

## Session Storage

```
sessions/
  <session-id>/
    meta.json        — task, status, config, start/end timestamps
    events.jsonl     — append-only event log (complete audit trail)
    memory.db        — SQLite: conversation history (with screenshots), task notes
    screenshots/     — PNG files (when SCREENSHOT_MODE=always or on_failure)
```

Sessions are never deleted automatically.

---

## Tests

```bash
# All tests (unit + integration, requires Chrome on port 9222)
npm test

# Unit tests only (no Chrome required)
npx vitest run --ignore='**/integration/**'

# Integration tests only
CHROME_PORT=9222 npx vitest run src/__tests__/integration/
```
