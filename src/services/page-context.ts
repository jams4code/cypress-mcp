// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// Turns what runtime/support.js recorded in the browser into the page context
// of each failure, and suggests selectors that exist on the page when the
// failing one matched nothing.
import type { CypressRunResult, FailureDetail, PageContext } from "../types/results.js";
import type { ContextPayload } from "./run-workspace.js";

const MAX_SUGGESTIONS = 3;
/** Below this bigram similarity a selector is not worth suggesting. */
const MIN_SIMILARITY = 0.35;

/** The result with each failure's page context, from the last failed attempt. */
export function attachPageContexts(
  result: CypressRunResult,
  payloads: readonly ContextPayload[],
): CypressRunResult {
  if (payloads.length === 0 || result.failures.length === 0) {
    return result;
  }
  const failures = result.failures.map((failure) => {
    // The last payload wins: with retries, it is the final attempt's.
    const payload = [...payloads]
      .reverse()
      .find(
        (p) =>
          p.title === failure.fullTitle &&
          (!failure.spec || !p.spec || samePath(p.spec, failure.spec)),
      );
    return payload ? { ...failure, page: toPageContext(payload, failure) } : failure;
  });
  return { ...result, failures };
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/") === b.replace(/\\/g, "/");
}

export function toPageContext(
  payload: ContextPayload,
  failure: FailureDetail,
): PageContext {
  const failedSelector = payload.failedSelector ?? selectorFromError(failure.error);
  const matches = typeof payload.matches === "number" ? payload.matches : undefined;
  return {
    ...(payload.url ? { url: payload.url } : {}),
    ...(payload.pageTitle ? { pageTitle: payload.pageTitle } : {}),
    ...(failedSelector ? { failedSelector } : {}),
    ...(matches !== undefined ? { matches } : {}),
    // When the selector matched, the element is there and its state is the
    // problem: similar selectors would only distract.
    suggestions:
      failedSelector && !matches
        ? suggestSelectors(failedSelector, payload.inventory ?? [])
        : [],
    console: (payload.console ?? []).map((entry) => ({
      level: String(entry.level),
      text: String(entry.text),
    })),
    network: (payload.network ?? []).map((entry) => ({
      method: String(entry.method),
      url: String(entry.url),
      status: typeof entry.status === "number" ? entry.status : String(entry.status),
    })),
    commands: (payload.commands ?? []).map((entry) => ({
      name: String(entry.name),
      message: String(entry.message),
      state: String(entry.state),
    })),
    ...(payload.outline ? { outline: payload.outline } : {}),
    ...(payload.outlineTruncated ? { outlineTruncated: true } : {}),
  };
}

/** The selector Cypress names in "Expected to find element: `...`". */
export function selectorFromError(error: string): string | undefined {
  return /(?:find element|find content|element): `([^`]+)`/.exec(error)?.[1];
}

/**
 * Selectors from the page that look like `failed`, best first. Compares the
 * attribute value or id the selector targets (`login-button` in
 * `[data-cy="login-button"]`) with those on the page, so a renamed test id
 * or a typo is found. Exported for tests.
 */
export function suggestSelectors(failed: string, inventory: readonly string[]): string[] {
  const target = selectorKey(failed);
  if (!target) {
    return [];
  }
  const targetAttribute = attributeOf(failed);

  return [...new Set(inventory)]
    .filter((candidate) => candidate !== failed)
    .map((candidate) => {
      const key = selectorKey(candidate);
      let score = key ? similarity(target.value, key.value) : 0;
      // The same kind of selector (data-cy for data-cy) is the likelier fix.
      if (score > 0 && targetAttribute && attributeOf(candidate) === targetAttribute) {
        score += 0.1;
      }
      return { candidate, score };
    })
    .filter((entry) => entry.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.candidate);
}

/** The value a selector looks for: an attribute value, an id, a class or button text. */
function selectorKey(selector: string): { value: string } | undefined {
  const quoted = /\[[\w-]+\s*[*^$~|]?=\s*["']?([^"'\]]+)["']?\s*\]/.exec(selector)?.[1];
  if (quoted) return { value: quoted };
  const text = /^(?:button|a)\s+"(.+)"$/.exec(selector)?.[1];
  if (text) return { value: text };
  const id = /#([\w-]+)/.exec(selector)?.[1];
  if (id) return { value: id };
  const className = /\.([\w-]+)/.exec(selector)?.[1];
  if (className) return { value: className };
  return undefined;
}

function attributeOf(selector: string): string | undefined {
  const attribute = /\[([\w-]+)\s*[*^$~|]?=/.exec(selector)?.[1];
  if (attribute) return attribute;
  if (/^#/.test(selector.trim())) return "id";
  return undefined;
}

/** Sorensen-Dice similarity of character bigrams, case and separators ignored. */
function similarity(a: string, b: string): number {
  const normalize = (value: string): string =>
    value.toLowerCase().replace(/[\s_-]+/g, "");
  const left = bigrams(normalize(a));
  const right = bigrams(normalize(b));
  let total = 0;
  let shared = 0;
  for (const count of left.values()) total += count;
  for (const [pair, count] of right) {
    total += count;
    shared += Math.min(count, left.get(pair) ?? 0);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}

function bigrams(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i++) {
    const pair = value.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}
