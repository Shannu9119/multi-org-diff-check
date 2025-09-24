import * as jsdiff from 'diff';

export type DiffSummary = {
  isDifferent: boolean;
  added: number;
  removed: number;
  firstChangeLine: number | null; // 1-based
};

export function computeDiffPatch(a: string, b: string): string {
  return jsdiff.createPatch('diff', a, b);
}

export function summarizeDiff(a: string, b: string): DiffSummary {
  const diff = jsdiff.diffLines(a, b);
  let added = 0;
  let removed = 0;
  let isDifferent = false;
  let lineA = 1;
  let firstChangeLine: number | null = null;
  for (const part of diff) {
    if (part.added) {
      isDifferent = true;
      added += part.count || 0;
      if (firstChangeLine === null) firstChangeLine = lineA; // show where change starts vs original
    } else if (part.removed) {
      isDifferent = true;
      removed += part.count || 0;
      if (firstChangeLine === null) firstChangeLine = lineA;
      lineA += part.count || 0;
    } else {
      lineA += part.count || 0;
    }
  }
  return { isDifferent, added, removed, firstChangeLine };
}
