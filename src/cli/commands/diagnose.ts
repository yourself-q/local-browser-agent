import { chromium } from 'playwright';
import { captureAccessibilityTree } from '../../state/accessibility.js';
import { captureDOMSnapshot } from '../../state/dom.js';
import { flattenInteractive } from '../../state/normalizer.js';
import { analyzeTemporalStability } from '../../state/stability.js';
import { batchCheckInteractability } from '../../grounding/interactability.js';
import type { AccessibilityNode } from '../../state/types.js';
import chalk from 'chalk';

// ─── Diagnose command ─────────────────────────────────────────────────────────

export interface DiagnoseOptions {
  port: number;
  url?: string;
  showTree?: boolean;
  showDom?: boolean;
  depth?: number;
  /** Run full temporal stability analysis (slower — 3 captures at 0/300/800ms) */
  stability?: boolean;
}

export async function diagnose(opts: DiagnoseOptions): Promise<void> {
  const endpoint = `http://localhost:${opts.port}`;
  const maxDepth = opts.depth ?? 3;

  console.log(chalk.bold.blue(`\n🔍 Browser Agent Diagnostic`));
  console.log(chalk.gray(`Endpoint: ${endpoint}\n`));

  // ─── Connect ───────────────────────────────────────────────────────────────
  let browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
  } catch {
    console.error(chalk.red(`✗ Cannot connect to Chrome at ${endpoint}`));
    console.error(
      chalk.yellow(
        `  Start Chrome with:\n  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\\n    --remote-debugging-port=${opts.port} \\\n    --no-first-run \\\n    --no-default-browser-check`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const contexts = browser.contexts();
  if (!contexts[0]) {
    console.error(chalk.red('✗ No browser context. Open a tab first.'));
    await browser.close();
    return;
  }

  const context = contexts[0];
  const pages = context.pages();
  let page = pages[pages.length - 1]!;

  console.log(chalk.green(`✓ Connected`));
  console.log(chalk.gray(`  Contexts: ${contexts.length} | Pages: ${pages.length}`));

  if (opts.url) {
    await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 15000 });
    console.log(chalk.green(`✓ Navigated to ${opts.url}`));
  }

  const url = page.url();
  const title = await page.title();

  console.log(chalk.bold(`\n📄 Current Page`));
  console.log(`  URL:   ${chalk.cyan(url)}`);
  console.log(`  Title: ${chalk.cyan(title)}`);

  // ─── Tab list ──────────────────────────────────────────────────────────────
  console.log(chalk.bold(`\n📑 Open Tabs (${pages.length})`));
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const marker = p === page ? chalk.green('▶') : ' ';
    console.log(`  ${marker} [${i}] ${p.url().slice(0, 80)}`);
  }

  // ─── A11y tree capture (initial) ──────────────────────────────────────────
  console.log(chalk.bold(`\n🌳 Accessibility Tree`));
  const t1 = Date.now();
  const a11y = await captureAccessibilityTree(page);
  const t1ms = Date.now() - t1;
  const interactive = flattenInteractive(a11y.tree);

  console.log(`  Captured in ${t1ms}ms`);
  console.log(`  Hash:        ${chalk.yellow(a11y.treeHash.slice(0, 16))}`);
  console.log(`  Total nodes: ${chalk.cyan(String(countNodes(a11y.tree)))}`);
  console.log(`  Interactive: ${chalk.cyan(String(interactive.length))} elements`);

  // ─── Temporal stability ────────────────────────────────────────────────────
  console.log(chalk.bold(`\n⏱  Temporal Stability`));

  if (opts.stability) {
    const stability = await analyzeTemporalStability(page, [0, 300, 800]);
    const c1 = stability.captures[0]!;
    const c2 = stability.captures[1]!;
    const c3 = stability.captures[2]!;

    const overallColor = stability.overallStability >= 0.9 ? chalk.green
      : stability.overallStability >= 0.7 ? chalk.yellow
      : chalk.red;

    console.log(`  Overall stability: ${overallColor((stability.overallStability * 100).toFixed(1) + '%')}`);
    console.log(`  t=0ms:   hash=${c1.treeHash.slice(0, 10)} nodes=${c1.nodeCount} interactive=${c1.interactiveCount}`);
    console.log(`  t=300ms: hash=${c2.treeHash.slice(0, 10)} nodes=${c2.nodeCount} interactive=${c2.interactiveCount} (overlap: ${(stability.nodeIdOverlap12 * 100).toFixed(0)}%)`);
    console.log(`  t=800ms: hash=${c3.treeHash.slice(0, 10)} nodes=${c3.nodeCount} interactive=${c3.interactiveCount} (overlap: ${(stability.nodeIdOverlap23 * 100).toFixed(0)}%)`);

    if (stability.churningNodes.length > 0) {
      console.log(`  Churning nodes: ${chalk.yellow(String(stability.churningNodes.length))}`);
    }
    console.log(`  ${chalk.gray('→')} ${stability.recommendation}`);
  } else {
    // Quick 2-capture check
    await page.waitForTimeout(300);
    const a11y2 = await captureAccessibilityTree(page);
    const stable = a11y.treeHash === a11y2.treeHash;

    if (stable) {
      console.log(`  ${chalk.green('✓ STABLE')} (same hash after 300ms)`);
    } else {
      const ids1 = new Set(a11y.clickableElements.map((e) => e.nodeId));
      const ids2 = new Set(a11y2.clickableElements.map((e) => e.nodeId));
      const overlap = ids1.size > 0 ? [...ids1].filter((id) => ids2.has(id)).length / ids1.size : 1;
      const color = overlap >= 0.85 ? chalk.green : overlap >= 0.6 ? chalk.yellow : chalk.red;
      console.log(`  ${color((overlap * 100).toFixed(0) + '% nodeId overlap')} after 300ms — page is dynamic`);
    }
    console.log(chalk.gray(`  Run with --stability for full 3-point temporal analysis`));
  }

  // ─── Interactive elements ──────────────────────────────────────────────────
  console.log(chalk.bold(`\n🖱  Interactive Elements (${interactive.length} total, showing first 25)`));
  for (const el of interactive.slice(0, 25)) {
    const id = chalk.gray(`[${el.nodeId.slice(0, 8)}]`);
    const role = chalk.yellow(el.role.padEnd(14));
    const name = el.name ? chalk.white(`"${el.name.slice(0, 55)}"`) : chalk.gray('(no name)');
    const value = el.value ? chalk.gray(` = ${el.value.slice(0, 20)}`) : '';
    const disabled = el.isDisabled ? chalk.red(' DISABLED') : '';
    console.log(`  ${id} ${role} ${name}${value}${disabled}`);
  }
  if (interactive.length > 25) {
    console.log(chalk.gray(`  ... and ${interactive.length - 25} more`));
  }

  // ─── Overlay detection ─────────────────────────────────────────────────────
  const MODAL_ROLES = new Set(['dialog', 'alertdialog', 'alert']);
  const overlays = findByRole(a11y.tree, MODAL_ROLES);

  console.log(chalk.bold(`\n🚧 Overlay Detection`));
  if (overlays.length === 0) {
    console.log(`  ${chalk.green('✓')} No modals/dialogs detected`);
  } else {
    console.log(`  ${chalk.yellow(`⚠ ${overlays.length} modal(s) detected:`)}`);
    for (const o of overlays) {
      console.log(`    ${chalk.red(o.role)}: "${o.name}" [${o.nodeId.slice(0, 8)}]`);
    }
    console.log(`  ${chalk.yellow('→')} Close overlays before running agent — they block grounding`);
  }

  // ─── Interactability score ────────────────────────────────────────────────
  console.log(chalk.bold(`\n🎯 Interactability Scores (first 10 elements)`));
  console.log(chalk.gray(`  Checks: visibility, pointer-events, opacity, z-index, viewport clip, topmost`));

  const interactabilityResults = await batchCheckInteractability(
    interactive.slice(0, 10).map((el) => ({
      nodeId: el.nodeId,
      role: el.role,
      name: el.name,
    })),
    page,
    10,
  );

  for (const r of interactabilityResults) {
    const bar = scoreBar(r.score);
    const statusColor = r.likely ? chalk.green : chalk.red;
    const issue = r.primaryIssue ? chalk.gray(` [${r.primaryIssue}]`) : '';
    const nameStr = r.name.slice(0, 40);
    console.log(
      `  ${bar} ${statusColor((r.score * 100).toFixed(0).padStart(3) + '%')} ${chalk.yellow(r.role.padEnd(12))} "${nameStr}"${issue}`,
    );
  }

  const avgScore = interactabilityResults.length > 0
    ? interactabilityResults.reduce((s, r) => s + r.score, 0) / interactabilityResults.length
    : 0;
  const likelyCount = interactabilityResults.filter((r) => r.likely).length;

  console.log(
    chalk.gray(`  Average: ${(avgScore * 100).toFixed(0)}% | Likely interactable: ${likelyCount}/${interactabilityResults.length}`),
  );

  // ─── DOM snapshot ──────────────────────────────────────────────────────────
  console.log(chalk.bold(`\n📦 DOM Snapshot`));
  const domSnapshot = await captureDOMSnapshot(page);
  console.log(`  Hash:    ${chalk.yellow(domSnapshot.hash.slice(0, 16))}`);
  console.log(`  Indexed: ${chalk.cyan(String(domSnapshot.elementIndex.length))} elements`);

  // A11y/DOM coverage
  const a11yNames = new Set(interactive.map((e) => e.name.toLowerCase().trim()).filter(Boolean));
  const crossRef = domSnapshot.elementIndex.filter((e) => {
    const t = e.text.toLowerCase().trim();
    return t && [...a11yNames].some((n) => t.includes(n) || n.includes(t));
  }).length;
  const coveragePct = domSnapshot.elementIndex.length > 0
    ? Math.round((crossRef / domSnapshot.elementIndex.length) * 100) : 0;
  const coverageColor = coveragePct >= 60 ? chalk.green : coveragePct >= 30 ? chalk.yellow : chalk.red;
  console.log(`  A11y/DOM match: ${coverageColor(`~${coveragePct}%`)}`);

  // ─── A11y tree dump ────────────────────────────────────────────────────────
  if (opts.showTree) {
    console.log(chalk.bold(`\n🌲 Accessibility Tree (depth ≤ ${maxDepth})`));
    printTree(a11y.tree, 0, maxDepth);
  }

  // ─── Overall score ────────────────────────────────────────────────────────
  console.log(chalk.bold(`\n📊 Groundability Score`));
  const hasStabilityData = opts.stability;

  const score = computeGroundabilityScore({
    interactive: interactive.length,
    overlays: overlays.length,
    coveragePct,
    avgInteractability: avgScore,
  });

  const scoreColor = score >= 80 ? chalk.green : score >= 55 ? chalk.yellow : chalk.red;
  const scoreBar2 = scoreBar(score / 100);
  console.log(`  ${scoreBar2} ${scoreColor(`${score}/100`)}`);
  console.log(chalk.gray(`  Components: a11y(${interactive.length} elements) + overlay(${overlays.length === 0 ? 'none' : overlays.length}) + interactability(${(avgScore * 100).toFixed(0)}%) + dom-match(${coveragePct}%)`));

  if (overlays.length > 0) {
    console.log(chalk.yellow(`  ⚠ Close overlays → score will improve`));
  }
  if (interactive.length < 3) {
    console.log(chalk.yellow(`  ⚠ Page may still be loading — try after network idle`));
  }
  if (avgScore < 0.5) {
    console.log(chalk.yellow(`  ⚠ Low interactability — check pointer-events and z-index issues`));
  }

  console.log('');
  await browser.close();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countNodes(node: AccessibilityNode): number {
  return 1 + node.children.reduce((s, c) => s + countNodes(c), 0);
}

function findByRole(
  node: AccessibilityNode,
  roles: Set<string>,
  result: AccessibilityNode[] = [],
): AccessibilityNode[] {
  if (roles.has(node.role)) result.push(node);
  for (const child of node.children) findByRole(child, roles, result);
  return result;
}

function printTree(node: AccessibilityNode, depth: number, maxDepth: number): void {
  if (depth > maxDepth) {
    if (node.children.length > 0) console.log(`${'  '.repeat(depth)}${chalk.gray('...')}`);
    return;
  }
  const indent = '  '.repeat(depth);
  const id = chalk.gray(`[${node.nodeId.slice(0, 6)}]`);
  const role = node.isInteractive ? chalk.yellow(node.role) : chalk.gray(node.role);
  const name = node.name ? ` ${chalk.white(`"${node.name.slice(0, 50)}"`)  }` : '';
  const debug = node.attributes['data-fingerprint-debug']
    ? chalk.gray(` (${node.attributes['data-fingerprint-debug']})`)
    : '';
  const disabled = node.isDisabled ? chalk.red(' DIS') : '';
  console.log(`${indent}${id} ${role}${name}${disabled}${debug}`);
  for (const child of node.children) printTree(child, depth + 1, maxDepth);
}

function scoreBar(value: number): string {
  const filled = Math.round(value * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const color = value >= 0.8 ? chalk.green : value >= 0.5 ? chalk.yellow : chalk.red;
  return color(bar);
}

function computeGroundabilityScore(opts: {
  interactive: number;
  overlays: number;
  coveragePct: number;
  avgInteractability: number;
}): number {
  let score = 0;

  // Interactive element count
  if (opts.interactive >= 20) score += 25;
  else if (opts.interactive >= 8) score += 18;
  else if (opts.interactive >= 3) score += 10;
  else score += 3;

  // Overlay penalty
  if (opts.overlays === 0) score += 20;
  else if (opts.overlays === 1) score += 5;
  // > 1 overlay: no points

  // Interactability score
  score += Math.round(opts.avgInteractability * 30);

  // DOM/A11y cross-reference
  score += Math.round(opts.coveragePct * 0.25);

  return Math.min(100, Math.max(0, score));
}
