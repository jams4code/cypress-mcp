// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

/**
 * The titles closest to `query`, best first. A title that contains the query
 * (what @cypress/grep matches on) ranks first; the rest are ranked by
 * character-bigram overlap (Sorensen-Dice), which tolerates typos, reordered
 * words and partial titles. Titles that share no bigram are left out.
 */
export function closestTitles(
  query: string,
  titles: readonly string[],
  limit = 3,
): string[] {
  const needle = normalize(query);
  const needleBigrams = bigrams(needle);

  return [...new Set(titles)]
    .map((title) => {
      const haystack = normalize(title);
      const score = haystack.includes(needle)
        ? 2
        : dice(needleBigrams, bigrams(haystack));
      return { title, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.title);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function bigrams(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i++) {
    const pair = value.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

function dice(a: Map<string, number>, b: Map<string, number>): number {
  let total = 0;
  let shared = 0;
  for (const count of a.values()) total += count;
  for (const [pair, count] of b) {
    total += count;
    shared += Math.min(count, a.get(pair) ?? 0);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}
