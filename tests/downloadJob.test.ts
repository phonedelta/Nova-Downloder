import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampProgress,
  computeProgress,
  formatBytes,
  formatETA,
  formatSpeed,
  smoothSpeed,
  computeEtaSeconds,
  minSuccessBytes,
} from "../packages/shared/src/downloadJob.ts";

test("computeProgress exact only — never invent % from estimate", () => {
  const exact = computeProgress(318e6, 760e6, null);
  assert.equal(exact.estimated, false);
  assert.ok(exact.progress !== null && exact.progress > 41 && exact.progress < 42);

  const noTotal = computeProgress(318e6, null, 760e6);
  assert.equal(noTotal.estimated, false);
  assert.equal(noTotal.progress, null);

  assert.equal(computeProgress(10, -1, null).progress, null);
  assert.equal(computeProgress(10, 0, 100).progress, null);
});

test("clampProgress bounds", () => {
  assert.equal(clampProgress(-5), 0);
  assert.equal(clampProgress(150), 100);
  assert.equal(clampProgress(42.7), 42.7);
});

test("formatBytes / formatSpeed / formatETA", () => {
  assert.equal(formatBytes(846_000), "846 KB");
  assert.match(formatBytes(18.4e6), /18\.4 MB/);
  assert.equal(formatSpeed(4.7e6), "4.7 MB/s");
  assert.equal(formatETA(12), "12 s");
  assert.equal(formatETA(92), "1 min 32 s");
  assert.equal(formatETA(null), "");
});

test("smoothSpeed EMA and eta", () => {
  const s = smoothSpeed(2e6, 10e6);
  assert.ok(s > 2e6 && s < 10e6);
  assert.equal(computeEtaSeconds(1000, 0), null);
  assert.ok((computeEtaSeconds(10e6, 1e6) ?? 0) > 9);
});

test("minSuccessBytes rejects tiny JSON-sized bodies for video", () => {
  assert.ok(minSuccessBytes("video") > 80);
  assert.ok(minSuccessBytes("audio") > 80);
  assert.ok(80 < minSuccessBytes("video"));
});
