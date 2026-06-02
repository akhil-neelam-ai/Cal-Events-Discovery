/**
 * Expected minimum healthy event counts per source.
 * Falling below these thresholds emits warnings — not pipeline failures —
 * because some sources are platform-capped or naturally sparse.
 */

export const SOURCE_EXPECTED_MIN_COUNTS: Record<string, number> = {
  livewhale: 100,
  callink: 5,
  cal_performances: 10,
  calbears: 15,
  bampfa: 20,
  haas: 5,
  berkeley_law: 3,
  simons: 10,
  ehub: 1,
  luma: 1,
  begin: 1,
};

interface CoverageSource {
  name?: string;
  ok?: boolean;
  count?: number;
}

export function evaluateSourceCoverageWarnings(sources: unknown): string[] {
  if (!Array.isArray(sources)) {
    return [];
  }

  const warnings: string[] = [];

  for (const source of sources as CoverageSource[]) {
    const name = String(source.name ?? "");
    const expectedMin = SOURCE_EXPECTED_MIN_COUNTS[name];
    const count = Number(source.count ?? 0);

    if (typeof expectedMin !== "number" || expectedMin <= 0) {
      continue;
    }

    if (source.ok === true && Number.isFinite(count) && count < expectedMin) {
      warnings.push(
        `${name} returned ${count} events (expected >= ${expectedMin})`,
      );
    }
  }

  return warnings;
}
