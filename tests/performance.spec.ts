import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  callRaceHook,
  captureRuntimeErrors,
  expectNoRuntimeErrors,
  readRaceDiagnostics,
  waitForRaceGame,
} from './race-test-helpers';

const RUN_PRODUCTION_PERFORMANCE = process.env.PERFORMANCE_PRODUCTION_PREVIEW === '1';
const SAMPLE_DURATION_MS = 8_400;
const REPORT_PATH = resolve('artifacts', 'performance-1920x1080.json');

type GpuEvidence = {
  vendor: string;
  renderer: string;
  softwareRendered: boolean;
};

type RafSample = {
  durationMs: number;
  intervals: number[];
};

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

function longestRunAbove(samples: readonly number[], threshold: number): number {
  let longest = 0;
  let current = 0;
  for (const sample of samples) {
    current = sample > threshold ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

test('production preview sustains the 1920x1080 active-race performance budget', async ({
  page,
}, testInfo) => {
  test.skip(
    !RUN_PRODUCTION_PERFORMANCE,
    'Run against npm run preview with PERFORMANCE_PRODUCTION_PREVIEW=1.',
  );
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The measured target is desktop 1920x1080.');
  test.setTimeout(45_000);

  const errors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await waitForRaceGame(page);
  await callRaceHook(page, 'seed', 20260819);
  await callRaceHook(page, 'hideDebugUi', true);
  await callRaceHook(page, 'setReducedMotion', false);
  await callRaceHook(page, 'setPausedForScreenshot', false);
  await callRaceHook(page, 'setState', 'active-play');

  const productionEvidence = await page.evaluate(() => {
    const resources = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name);
    return {
      hasViteDevelopmentClient: resources.some((url) => url.includes('/@vite/client')),
      url: window.location.href,
    };
  });
  expect(productionEvidence.hasViteDevelopmentClient, 'measurement must run against built preview assets').toBe(false);

  // Warm the shaders, wakes, AI, camera, and input path before sampling.
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('Space');
  await page.waitForTimeout(700);
  await page.keyboard.up('Space');
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyA');

  const before = await readRaceDiagnostics(page);
  const gpu = await page.evaluate<GpuEvidence>(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!gl) return { vendor: 'unavailable', renderer: 'unavailable', softwareRendered: true };
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = extension
      ? String(gl.getParameter(extension.UNMASKED_VENDOR_WEBGL))
      : String(gl.getParameter(gl.VENDOR));
    const renderer = extension
      ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    return {
      vendor,
      renderer,
      softwareRendered: /swiftshader|llvmpipe|software raster|software renderer/i.test(
        `${vendor} ${renderer}`,
      ),
    };
  });

  let sample: RafSample;
  try {
    sample = await page.evaluate((durationMs) =>
      new Promise<RafSample>((resolveSample) => {
        const intervals: number[] = [];
        const startedAt = performance.now();
        let previous = startedAt;
        const tick = (now: number) => {
          intervals.push(now - previous);
          previous = now;
          if (now - startedAt >= durationMs) {
            resolveSample({ durationMs: now - startedAt, intervals });
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }), SAMPLE_DURATION_MS);
  } finally {
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
  }

  const after = await readRaceDiagnostics(page);
  const sorted = [...sample.intervals].sort((a, b) => a - b);
  const averageFrameMs = sample.intervals.reduce((sum, value) => sum + value, 0) / sample.intervals.length;
  const report = {
    target: '1920x1080 production preview active race at ~60 FPS',
    viewport: { width: 1920, height: 1080 },
    productionEvidence,
    gpu,
    sampleDurationMs: Number(sample.durationMs.toFixed(2)),
    sampledFrames: sample.intervals.length,
    framesAdvanced: after.frame - before.frame,
    raceTimeAdvanced: Number((after.raceTime - before.raceTime).toFixed(2)),
    timing: {
      averageFrameMs: Number(averageFrameMs.toFixed(3)),
      p50FrameMs: Number(percentile(sorted, 0.5).toFixed(3)),
      p95FrameMs: Number(percentile(sorted, 0.95).toFixed(3)),
      p99FrameMs: Number(percentile(sorted, 0.99).toFixed(3)),
      averageFps: Number((1000 / averageFrameMs).toFixed(2)),
      framesOver25Ms: sample.intervals.filter((value) => value > 25).length,
      longestRunOver25Ms: longestRunAbove(sample.intervals, 25),
    },
    renderer: after.renderer,
    renderBudget: {
      calls: 180,
      triangles: 120_000,
      geometries: 140,
      textures: 32,
    },
    consoleErrors: errors.consoleErrors,
    pageErrors: errors.pageErrors,
  };

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await testInfo.attach('performance-1920x1080', {
    path: REPORT_PATH,
    contentType: 'application/json',
  });
  console.log(`performance 1920x1080: ${JSON.stringify(report)}`);

  expectNoRuntimeErrors(errors);
  expect(gpu.softwareRendered, `real GPU required for FPS evidence: ${gpu.renderer}`).toBe(false);
  expect(report.sampleDurationMs).toBeGreaterThanOrEqual(8_000);
  expect(report.sampledFrames).toBeGreaterThanOrEqual(430);
  expect(report.framesAdvanced).toBeGreaterThanOrEqual(430);
  expect(report.raceTimeAdvanced).toBeGreaterThanOrEqual(8);
  expect(report.timing.averageFps, 'average frame rate should stay near the 60 FPS target').toBeGreaterThanOrEqual(58);
  expect(report.timing.averageFrameMs).toBeLessThanOrEqual(17.25);
  expect(report.timing.p95FrameMs).toBeLessThanOrEqual(18);
  expect(report.timing.p99FrameMs).toBeLessThanOrEqual(22);
  expect(report.timing.longestRunOver25Ms, 'slow frames may not persist').toBeLessThanOrEqual(2);
  expect(report.renderer.calls).toBeLessThanOrEqual(report.renderBudget.calls);
  expect(report.renderer.triangles).toBeLessThanOrEqual(report.renderBudget.triangles);
  expect(report.renderer.geometries).toBeLessThanOrEqual(report.renderBudget.geometries);
  expect(report.renderer.textures).toBeLessThanOrEqual(report.renderBudget.textures);
});
