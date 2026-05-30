# browser-agent

Local-first browser agent runtime.
- Attaches to your **existing Chrome session** via CDP (no isolated Chromium).
- **Accessibility-tree-first** grounding. DOM fallback. Vision last resort.
- **Event-sourced** — every action, state transition, and recovery is logged.
- Works with a **local LM Studio** OpenAI-compatible endpoint.
- Exposes a **CLI**, **MCP server**, and **OpenAI-compatible API**.

---

## Architecture

```
CLI / MCP / API
     │
AgentOrchestrator
     │
Runtime Loop: capture → decide → ground → execute → verify → recover
     │              │              │           │
  StateCapturer  LLMClient   GroundingEngine  ToolExecutor
  (A11y+DOM)   (LM Studio)  (a11y→dom→vision) (Playwright)
     │
 BrowserManager
 connectOverCDP() → existing Chrome
```

---

## Requirements

- Node.js 18+
- Chrome (with remote debugging enabled — see below)
- LM Studio running locally with a loaded model

---

## Setup

```bash
cp .env.example .env
# Edit .env with your LM Studio URL and model name

npm install
npx playwright install chromium  # only needed for non-CDP features
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

**Or create a shell alias:**
```bash
alias chrome-debug='/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --no-first-run'
```

Chrome must be running before you use the agent.

---

## Step 1: Diagnose (always run this first)

```bash
# Basic diagnostic — shows a11y tree quality, interactive elements, grounding confidence
npx tsx src/cli/index.ts diagnose --port 9222

# Navigate to a specific URL before diagnosing
npx tsx src/cli/index.ts diagnose --port 9222 --url https://github.com

# Show the full accessibility tree (max depth 4)
npx tsx src/cli/index.ts diagnose --port 9222 --show-tree --depth 4
```

The diagnose command tells you:
- Whether Chrome is reachable
- How many interactive elements are visible
- Whether nodeIds are stable (important for grounding)
- Whether any modals/overlays are blocking
- Grounding confidence per element (unique/visible/ambiguous)
- An overall groundability score

---

## Step 2: Run a Task

```bash
npx tsx src/cli/index.ts run \
  --task "Find the trending repositories on GitHub" \
  --chrome-port 9222 \
  --model "qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive"
```

Options:
```
--task <text>          Task description (required)
--session <id>         Resume or name a session
--chrome-port <port>   Chrome debugging port (default: 9222)
--model <name>         LM Studio model name
--max-steps <n>        Max agent steps (default: 50)
--approval             Enable human approval mode
--deterministic        Deterministic mode (temp=0, strict schemas)
--sessions-dir <dir>   Where to store sessions (default: ./sessions)
```

---

## Step 3: Inspect What Happened

```bash
# List all sessions
npx tsx src/cli/index.ts list

# Replay event log for a session
npx tsx src/cli/index.ts replay --session <session-id>

# Full inspection
npx tsx src/cli/index.ts inspect --session <session-id>
```

---

## MCP Server

```bash
npx tsx src/cli/index.ts mcp
```

Configure in your Claude config:
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

Tools exposed:
- `browser_run_task` — run an agent task
- `browser_get_state` — capture current page state
- `browser_list_sessions` — list all sessions

---

## OpenAI-Compatible API

```bash
npx tsx src/cli/index.ts serve --port 8080
```

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Go to github.com and find trending repos"}]}'
```

---

## Grounding Strategy

Elements are resolved in order:

1. **Accessibility tree** (primary)
   - Exact match by `nodeId` (from LLM response)
   - Fuzzy match by role + name (Levenshtein)
   - Playwright `getByRole()` locator

2. **DOM snapshot** (fallback)
   - Text/aria-label match in element index
   - CSS selector generation

3. **Vision** (last resort — logged as degraded)
   - Screenshot → LLM bounding box request
   - Coordinate-based click
   - Only if `VisionProvider.isAvailable()` returns true

---

## Event Log Format

Every session writes to `sessions/<id>/events.jsonl`:

```json
{"id":"uuid","type":"state.captured","sessionId":"...","stepIndex":0,"timestamp":1234,"payload":{...}}
{"id":"uuid","type":"action.decided","sessionId":"...","stepIndex":0,"timestamp":1234,"payload":{"action":"click","reasoning":"...","confidence":0.9}}
{"id":"uuid","type":"grounding.succeeded","sessionId":"...","stepIndex":0,"timestamp":1234,"payload":{"element":{"strategy":"a11y","nodeId":"..."}}}
```

---

## LM Studio Configuration

In LM Studio:
1. Load `qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive` (or any model)
2. Enable the local server (default: `http://localhost:1234`)
3. Set in `.env`:
   ```
   LM_STUDIO_BASE_URL=http://localhost:1234/v1
   AGENT_MODEL=qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive
   ```

The model must support JSON output mode (`response_format: {type: "json_object"}`).
If it doesn't, the agent falls back to regex JSON extraction.

---

## Tests

```bash
# Unit tests (no Chrome required)
npm test

# Integration tests (Chrome required on port 9222)
CHROME_PORT=9222 npx vitest run src/__tests__/integration/
```

---

## Session Storage

```
sessions/
  <session-id>/
    meta.json          — task, status, config, timestamps
    events.jsonl       — append-only event log (every action + state)
    memory.db          — SQLite: conversation history, page facts
    screenshots/       — PNG files (when screenshot mode is enabled)
```

Sessions are never deleted automatically. Use `rm -rf sessions/<id>` to clean up.
