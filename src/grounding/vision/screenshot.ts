import type { VisionProvider, VisionHint, VisionGroundingResult } from './types.js';
import type { Rect } from '../../state/types.js';
import { createLogger } from '../../runtime/logger.js';

const log = createLogger('grounding:vision:screenshot');

// ─── Screenshot + LLM bounding box provider ───────────────────────────────────

/**
 * Default vision provider: sends the screenshot to the LLM and asks it to
 * identify the bounding box of the target element using vision capabilities.
 *
 * This is the fallback of last resort. Flagged in event logs as `strategy: 'vision'`.
 * Only works when the model has vision capabilities.
 */
export class ScreenshotVisionProvider implements VisionProvider {
  readonly name = 'screenshot-llm';

  constructor(
    private readonly llmBaseUrl: string,
    private readonly llmApiKey: string,
    private readonly model: string,
  ) {}

  async locate(
    screenshotBase64: string,
    description: string,
    _hint?: VisionHint,
  ): Promise<VisionGroundingResult> {
    try {
      const response = await fetch(`${this.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.llmApiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${screenshotBase64}` },
                },
                {
                  type: 'text',
                  text:
                    `Find the element matching: "${description}"\n` +
                    `Return ONLY a JSON object with this exact format:\n` +
                    `{"x": <number>, "y": <number>, "width": <number>, "height": <number>, "confidence": <0.0-1.0>}\n` +
                    `All values in pixels. If not found, return {"confidence": 0}.`,
                },
              ],
            },
          ],
          max_tokens: 1024,  // 150 was too low — Qwen3 thinking eats most tokens before JSON response
          temperature: 0.0,
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM vision request failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices[0]?.message.content ?? '';
      const parsed = extractJSON(content) as
        | ({ confidence: number } & Partial<Rect>)
        | null;

      if (!parsed || (parsed.confidence ?? 0) < 0.3) {
        return { success: false, provider: this.name, error: 'Element not found visually' };
      }

      if (
        parsed.x === undefined ||
        parsed.y === undefined ||
        parsed.width === undefined ||
        parsed.height === undefined
      ) {
        return { success: false, provider: this.name, error: 'Incomplete bounding box' };
      }

      return {
        success: true,
        bounds: { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height },
        confidence: parsed.confidence,
        provider: this.name,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ error, description }, 'Vision grounding failed');
      return { success: false, provider: this.name, error };
    }
  }

  async isAvailable(): Promise<boolean> {
    // Check if model claims vision capability — for now, optimistically assume yes
    return true;
  }
}

// ─── NoOp provider (vision disabled) ─────────────────────────────────────────

export class NoOpVisionProvider implements VisionProvider {
  readonly name = 'noop';

  async locate(): Promise<VisionGroundingResult> {
    return { success: false, provider: this.name, error: 'Vision grounding is disabled' };
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }
}

// ─── JSON extractor ───────────────────────────────────────────────────────────

function extractJSON(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code block
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match?.[1]) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // Fall through
      }
    }
    // Try to find raw JSON object
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        // Fall through
      }
    }
    return null;
  }
}
