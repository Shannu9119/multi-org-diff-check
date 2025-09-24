import { computeDiffPatch, summarizeDiff } from '../diffEngine';

test('computeDiff returns unified diff for different content', () => {
  const a = 'hello world';
  const b = 'hello brave new world';
  const diff = computeDiffPatch(a, b);
  expect(diff).toContain('@@');
  expect(diff).toContain('-hello world');
  expect(diff).toContain('+hello brave new world');
  const summary = summarizeDiff(a, b);
  expect(summary.isDifferent).toBe(true);
  expect(summary.added + summary.removed).toBeGreaterThan(0);
});
