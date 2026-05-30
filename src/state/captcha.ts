import type { Page } from 'playwright';
import type { BrowserState } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CaptchaType =
  | 'cloudflare_challenge'
  | 'cloudflare_turnstile'
  | 'recaptcha_v2'
  | 'hcaptcha'
  | 'unknown_bot_check';

export interface CaptchaDetectionResult {
  detected: boolean;
  type?: CaptchaType;
  description: string;
}

// ─── Known title fragments for Cloudflare JS challenge pages ─────────────────

const CF_TITLES = [
  'just a moment',
  'checking your browser',
  'one moment please',
  'please wait',
  'attention required',
  'ddos-guard',
];

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect CAPTCHA or bot-check pages using three signals, cheapest first:
 *   1. URL pattern (instant, no page access)
 *   2. Page title (from BrowserState, no page access)
 *   3. DOM inspection via page.evaluate (one round-trip)
 */
export async function detectCaptcha(
  state: BrowserState,
  page: Page,
): Promise<CaptchaDetectionResult> {
  const url = state.url.toLowerCase();
  const title = (state.title ?? '').toLowerCase();

  // 1. URL-based detection
  if (url.includes('/cdn-cgi/challenge-platform') || url.includes('challenges.cloudflare.com')) {
    return {
      detected: true,
      type: 'cloudflare_challenge',
      description: 'Cloudflare challenge URL detected',
    };
  }

  // 2. Title-based detection (Cloudflare "Just a moment…")
  if (CF_TITLES.some((t) => title.includes(t))) {
    return {
      detected: true,
      type: 'cloudflare_challenge',
      description: `Cloudflare browser challenge page (title: "${state.title}")`,
    };
  }

  // 3. DOM-level detection (one round-trip — fast on a local Chrome)
  try {
    const found = await page.evaluate(() => {
      const q = (s: string) => !!document.querySelector(s);
      return {
        cfChallenge:
          q('#challenge-form') ||
          q('#cf-challenge-running') ||
          q('.cf-browser-verification') ||
          q('#cf-wrapper'),
        cfTurnstile:
          q('.cf-turnstile') ||
          q('iframe[src*="challenges.cloudflare.com"]'),
        recaptcha:
          q('.g-recaptcha') ||
          q('#recaptcha') ||
          q('iframe[src*="recaptcha.net"]') ||
          q('iframe[src*="google.com/recaptcha"]'),
        hcaptcha:
          q('.h-captcha') ||
          q('iframe[src*="hcaptcha.com"]'),
        perimeterx: q('#px-captcha') || q('#px-block-page-container'),
      };
    });

    if (found.cfChallenge) {
      return {
        detected: true,
        type: 'cloudflare_challenge',
        description: 'Cloudflare challenge form detected in DOM',
      };
    }
    if (found.cfTurnstile) {
      return {
        detected: true,
        type: 'cloudflare_turnstile',
        description: 'Cloudflare Turnstile widget detected',
      };
    }
    if (found.recaptcha) {
      return {
        detected: true,
        type: 'recaptcha_v2',
        description: 'reCAPTCHA widget detected',
      };
    }
    if (found.hcaptcha) {
      return {
        detected: true,
        type: 'hcaptcha',
        description: 'hCaptcha widget detected',
      };
    }
    if (found.perimeterx) {
      return {
        detected: true,
        type: 'unknown_bot_check',
        description: 'PerimeterX bot-check detected',
      };
    }
  } catch {
    // page.evaluate can fail if the page is mid-navigation — not a CAPTCHA
  }

  return { detected: false, description: 'No CAPTCHA detected' };
}
