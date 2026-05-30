import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';
import { createLogger } from '../../runtime/logger.js';

const log = createLogger('tool:search');

// ─── Search result types ──────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

// ─── Search tool ──────────────────────────────────────────────────────────────

/**
 * Web search tool.
 *
 * Priority:
 *   1. GEMINI_API_KEY → Gemini 2.5 Flash with Google Search grounding (free: 250 req/day)
 *   2. BRAVE_API_KEY  → Brave Search API
 *   3. TAVILY_API_KEY → Tavily Search API
 *
 * Set one of these in .env. No key = error with helpful message.
 */
export const SearchTool: ToolExecutor<{ query: string; count?: number }> = {
  name: 'search',
  description: 'Search the web and return top results as structured JSON',

  async execute({ query, count = 5 }, _ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();
    const geminiKey = process.env['GEMINI_API_KEY'];
    const braveKey  = process.env['BRAVE_API_KEY'];
    const tavilyKey = process.env['TAVILY_API_KEY'];

    try {
      let results: SearchResult[];

      if (geminiKey) {
        results = await searchViaGemini(query, count, geminiKey);
      } else if (braveKey) {
        results = await searchBrave(query, count, braveKey);
      } else if (tavilyKey) {
        results = await searchTavily(query, count, tavilyKey);
      } else {
        return {
          success: false,
          action: 'search',
          durationMs: Date.now() - start,
          error:
            'No search API key configured. Set GEMINI_API_KEY (recommended, free 250/day), ' +
            'BRAVE_API_KEY, or TAVILY_API_KEY in .env.',
        };
      }

      const output = JSON.stringify(results, null, 2);
      log.debug({ query, resultCount: results.length }, 'Search completed');

      return {
        success: true,
        action: 'search',
        durationMs: Date.now() - start,
        output,
      };
    } catch (err) {
      return {
        success: false,
        action: 'search',
        durationMs: Date.now() - start,
        error: `Search failed: ${String(err)}`,
      };
    }
  },
};

// ─── Gemini 2.5 Flash + Google Search grounding ───────────────────────────────

interface GeminiGroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  groundingMetadata?: {
    groundingChunks?: GeminiGroundingChunk[];
    searchEntryPoint?: { renderedContent?: string };
  };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

async function searchViaGemini(
  query: string,
  count: number,
  apiKey: string,
): Promise<SearchResult[]> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `Search the web for: ${query}\n\nList the top ${count} results with title, URL, and a brief description of each.` }],
      },
    ],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as GeminiResponse;
  const candidate = data.candidates?.[0];
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const summaryText = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

  // Build results from grounding chunks (web sources Gemini actually used)
  const results: SearchResult[] = chunks
    .filter((c): c is { web: { uri: string; title: string } } =>
      typeof c.web?.uri === 'string' && typeof c.web?.title === 'string',
    )
    .slice(0, count)
    .map((c) => ({
      title: c.web.title,
      url: c.web.uri,
      description: '',  // chunks don't include snippets; summary below covers it
    }));

  // If grounding chunks are sparse, fall back to including Gemini's summary as the first result
  if (results.length === 0 && summaryText) {
    results.push({
      title: `Search summary: ${query}`,
      url: '',
      description: summaryText.slice(0, 500),
    });
  } else if (summaryText) {
    // Attach summary as description to the first result
    results[0]!.description = summaryText.slice(0, 500);
  }

  return results;
}

// ─── Brave Search ─────────────────────────────────────────────────────────────

async function searchBrave(query: string, count: number, apiKey: string): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(count, 20)));
  url.searchParams.set('text_decorations', 'false');

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!res.ok) throw new Error(`Brave API error: ${res.status} ${res.statusText}`);

  const data = await res.json() as {
    web?: { results?: Array<{ title: string; url: string; description?: string }> };
  };

  return (data.web?.results ?? []).slice(0, count).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description ?? '',
  }));
}

// ─── Tavily Search ────────────────────────────────────────────────────────────

async function searchTavily(query: string, count: number, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(count, 10),
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!res.ok) throw new Error(`Tavily API error: ${res.status} ${res.statusText}`);

  const data = await res.json() as {
    results?: Array<{ title: string; url: string; content?: string }>;
  };

  return (data.results ?? []).slice(0, count).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.content ?? '',
  }));
}
