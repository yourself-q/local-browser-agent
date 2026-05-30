import { describe, test, expect, vi } from 'vitest';
import { detectCaptcha } from '../state/captcha.js';
import type { BrowserState } from '../state/types.js';
import type { Page } from 'playwright';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<BrowserState> = {}): BrowserState {
  return {
    url: 'https://example.com',
    title: 'Example',
    stepIndex: 0,
    clickableElements: [],
    tabs: [],
    screenshot: undefined,
    ...overrides,
  } as BrowserState;
}

function makePage(domResult = {
  cfChallenge: false,
  cfTurnstile: false,
  recaptcha: false,
  hcaptcha: false,
  perimeterx: false,
}): Page {
  return {
    evaluate: vi.fn().mockResolvedValue(domResult),
  } as unknown as Page;
}

// ─── URL-based detection ──────────────────────────────────────────────────────

describe('detectCaptcha — URL patterns', () => {
  test('detects Cloudflare challenge URL', async () => {
    const state = makeState({ url: 'https://example.com/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1' });
    const result = await detectCaptcha(state, makePage());
    expect(result.detected).toBe(true);
    expect(result.type).toBe('cloudflare_challenge');
  });

  test('detects challenges.cloudflare.com redirect', async () => {
    const state = makeState({ url: 'https://challenges.cloudflare.com/turnstile/v0/api.js' });
    const result = await detectCaptcha(state, makePage());
    expect(result.detected).toBe(true);
    expect(result.type).toBe('cloudflare_challenge');
  });

  test('does not flag normal URLs', async () => {
    const state = makeState({ url: 'https://github.com/trending' });
    const result = await detectCaptcha(state, makePage());
    expect(result.detected).toBe(false);
  });
});

// ─── Title-based detection ────────────────────────────────────────────────────

describe('detectCaptcha — title patterns', () => {
  test('detects "Just a moment..." title', async () => {
    const state = makeState({ title: 'Just a moment...' });
    const result = await detectCaptcha(state, makePage());
    expect(result.detected).toBe(true);
    expect(result.type).toBe('cloudflare_challenge');
  });

  test('detects "Checking your browser" title', async () => {
    const state = makeState({ title: 'Checking your browser before accessing.' });
    const result = await detectCaptcha(state, makePage());
    expect(result.detected).toBe(true);
    expect(result.type).toBe('cloudflare_challenge');
  });

  test('detects "Attention Required" title (case-insensitive)', async () => {
    const state = makeState({ title: 'Attention Required! | Cloudflare' });
    const result = await detectCaptcha(state, makePage());
    expect(result.detected).toBe(true);
  });

  test('does not flag normal page titles', async () => {
    const state = makeState({ title: 'GitHub: Let\'s build from here' });
    const result = await detectCaptcha(state, makePage());
    expect(result.detected).toBe(false);
  });
});

// ─── DOM-based detection ──────────────────────────────────────────────────────

describe('detectCaptcha — DOM inspection', () => {
  test('detects Cloudflare challenge form via DOM', async () => {
    const page = makePage({ cfChallenge: true, cfTurnstile: false, recaptcha: false, hcaptcha: false, perimeterx: false });
    const result = await detectCaptcha(makeState(), page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('cloudflare_challenge');
  });

  test('detects Cloudflare Turnstile widget', async () => {
    const page = makePage({ cfChallenge: false, cfTurnstile: true, recaptcha: false, hcaptcha: false, perimeterx: false });
    const result = await detectCaptcha(makeState(), page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('cloudflare_turnstile');
  });

  test('detects reCAPTCHA', async () => {
    const page = makePage({ cfChallenge: false, cfTurnstile: false, recaptcha: true, hcaptcha: false, perimeterx: false });
    const result = await detectCaptcha(makeState(), page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('recaptcha_v2');
  });

  test('detects hCaptcha', async () => {
    const page = makePage({ cfChallenge: false, cfTurnstile: false, recaptcha: false, hcaptcha: true, perimeterx: false });
    const result = await detectCaptcha(makeState(), page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('hcaptcha');
  });

  test('detects PerimeterX', async () => {
    const page = makePage({ cfChallenge: false, cfTurnstile: false, recaptcha: false, hcaptcha: false, perimeterx: true });
    const result = await detectCaptcha(makeState(), page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('unknown_bot_check');
  });

  test('returns not-detected when all DOM checks are false', async () => {
    const result = await detectCaptcha(makeState(), makePage());
    expect(result.detected).toBe(false);
  });

  test('does not throw when page.evaluate rejects (mid-navigation)', async () => {
    const page = { evaluate: vi.fn().mockRejectedValue(new Error('Execution context destroyed')) } as unknown as Page;
    const result = await detectCaptcha(makeState(), page);
    expect(result.detected).toBe(false);
  });
});

// ─── Priority: URL/title checked before DOM ───────────────────────────────────

describe('detectCaptcha — short-circuit priority', () => {
  test('URL match skips page.evaluate entirely', async () => {
    const page = makePage();
    const state = makeState({ url: 'https://example.com/cdn-cgi/challenge-platform/test' });
    await detectCaptcha(state, page);
    expect(vi.mocked(page.evaluate)).not.toHaveBeenCalled();
  });

  test('title match skips page.evaluate entirely', async () => {
    const page = makePage();
    const state = makeState({ title: 'Just a moment...' });
    await detectCaptcha(state, page);
    expect(vi.mocked(page.evaluate)).not.toHaveBeenCalled();
  });
});
