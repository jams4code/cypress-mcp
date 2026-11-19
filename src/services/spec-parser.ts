// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// One static parser for describe/it blocks, shared by cypress_discover,
// cypress_analyze_spec, cypress_list_specs and cypress_run_test. Regexes over
// the raw text kept finding tests inside strings and calls such as
// cy.visit("..."), so this scans the source once and skips strings, comments
// and regex literals. It is not a JavaScript parser: titles built at runtime
// (variables, string concatenation) are not seen, which is the same limit any
// static count has.

export type BlockMode = "only" | "skip";

export interface ParsedTest {
  readonly name: string;
  /** Suite titles and the test title joined by spaces, as Mocha builds fullTitle */
  readonly fullTitle: string;
  /** 1-based line of the it() call */
  readonly line: number;
  readonly mode?: BlockMode;
}

export interface ParsedSuite {
  readonly name: string;
  readonly line: number;
  readonly mode?: BlockMode;
  readonly tests: ParsedTest[];
  readonly hooks: string[];
  readonly suites: ParsedSuite[];
}

export interface ParsedSpec {
  /** Tests and hooks declared outside any describe, plus the top-level suites */
  readonly root: ParsedSuite;
  /** Every test in source order */
  readonly tests: readonly ParsedTest[];
  /** Every suite in source order, nested ones included */
  readonly suites: readonly ParsedSuite[];
}

const SUITE_CALLS = new Map<string, BlockMode | undefined>([
  ["describe", undefined],
  ["context", undefined],
  ["xdescribe", "skip"],
  ["xcontext", "skip"],
]);

const TEST_CALLS = new Map<string, BlockMode | undefined>([
  ["it", undefined],
  ["specify", undefined],
  ["xit", "skip"],
  ["xspecify", "skip"],
]);

const HOOK_CALLS = new Set(["before", "beforeEach", "after", "afterEach"]);

// After one of these characters a "/" starts a regex literal, not a division.
const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%<>~^");
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of"]);

interface OpenSuite {
  readonly suite: ParsedSuite;
  /** Paren depth inside the describe( call; the suite ends when it closes */
  readonly depth: number;
}

export function parseSpec(source: string): ParsedSpec {
  const root: ParsedSuite = { name: "", line: 0, tests: [], hooks: [], suites: [] };
  const tests: ParsedTest[] = [];
  const suites: ParsedSuite[] = [];
  const open: OpenSuite[] = [];
  const scanner = new Scanner(source);

  const current = (): ParsedSuite => open.at(-1)?.suite ?? root;
  const titlePath = (): string[] => open.map((entry) => entry.suite.name);

  scanner.run({
    onIdentifier(name, start) {
      const call = readCall(source, start + name.length);
      if (!call) {
        return;
      }

      if (HOOK_CALLS.has(name) && !call.modifier) {
        const hooks = current().hooks;
        if (!hooks.includes(name)) {
          hooks.push(name);
        }
        return;
      }

      const line = scanner.lineAt(start);
      const mode = modeOf(call.modifier) ?? SUITE_CALLS.get(name) ?? TEST_CALLS.get(name);

      if (SUITE_CALLS.has(name) && call.title !== undefined) {
        const suite: ParsedSuite = {
          name: call.title,
          line,
          ...(mode ? { mode } : {}),
          tests: [],
          hooks: [],
          suites: [],
        };
        current().suites.push(suite);
        suites.push(suite);
        // The scanner has not consumed the "(" yet, so the call body sits one
        // level deeper than the current depth.
        open.push({ suite, depth: scanner.depth + 1 });
        return;
      }

      if (TEST_CALLS.has(name) && call.title !== undefined) {
        const test: ParsedTest = {
          name: call.title,
          fullTitle: [...titlePath(), call.title].join(" "),
          line,
          ...(mode ? { mode } : {}),
        };
        current().tests.push(test);
        tests.push(test);
      }
    },
    onCloseParen(depthAfter) {
      while (open.length > 0 && depthAfter < open.at(-1)!.depth) {
        open.pop();
      }
    },
  });

  return { root, tests, suites };
}

function modeOf(modifier: string | undefined): BlockMode | undefined {
  return modifier === "only" || modifier === "skip" ? modifier : undefined;
}

interface CallInfo {
  readonly modifier?: string;
  /** Static title, when the first argument is a string or template literal */
  readonly title?: string;
}

/**
 * Look ahead from the end of an identifier for `.only` / `.skip` and an
 * opening paren, then read the first argument when it is a literal.
 * Returns undefined when the identifier is not called.
 */
function readCall(source: string, from: number): CallInfo | undefined {
  let index = skipBlank(source, from);
  let modifier: string | undefined;

  if (source[index] === ".") {
    const match = /^\.\s*(only|skip)\b/.exec(source.slice(index, index + 20));
    if (!match) {
      return undefined;
    }
    modifier = match[1];
    index = skipBlank(source, index + match[0].length);
  }

  if (source[index] !== "(") {
    return undefined;
  }

  index = skipBlank(source, index + 1);
  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return { modifier };
  }

  const literal = readLiteral(source, index);
  return { modifier, title: literal };
}

/** Skip whitespace and comments. */
function skipBlank(source: string, from: number): number {
  let index = from;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index++;
    } else if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end + 1;
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else {
      break;
    }
  }
  return index;
}

const ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r" };

/**
 * Read the string or template literal that starts at `start` and return its
 * text. Template placeholders are kept as written (`${n}`), which is what an
 * agent needs to recognize a generated title.
 */
function readLiteral(source: string, start: number): string | undefined {
  const quote = source[start];
  let text = "";
  let index = start + 1;
  let braces = 0;

  while (index < source.length) {
    const char = source[index]!;

    if (char === "\\") {
      const next = source[index + 1] ?? "";
      text += quote === "`" ? char + next : (ESCAPES[next] ?? next);
      index += 2;
      continue;
    }

    if (quote === "`") {
      if (braces === 0 && char === "`") {
        return text;
      }
      if (char === "$" && source[index + 1] === "{") {
        braces++;
        text += "${";
        index += 2;
        continue;
      }
      if (braces > 0 && char === "}") {
        braces--;
      }
    } else if (char === quote) {
      return text;
    } else if (char === "\n") {
      // Quoted strings cannot span lines: this was not a string after all.
      return undefined;
    }

    text += char;
    index++;
  }

  return undefined;
}

interface ScanHandlers {
  onIdentifier(name: string, start: number): void;
  onCloseParen(depthAfter: number): void;
}

/**
 * Walks the source once, tracking paren depth and line starts, and reports
 * identifiers that sit in code (not in strings, comments or regexes) and are
 * not a property access (`cy.it(` or `foo.describe(` are ignored).
 */
class Scanner {
  depth = 0;
  private readonly lineStarts: number[] = [0];

  constructor(private readonly source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") {
        this.lineStarts.push(i + 1);
      }
    }
  }

  lineAt(offset: number): number {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.lineStarts[mid]! <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low + 1;
  }

  run(handlers: ScanHandlers): void {
    const source = this.source;
    // Last significant character or word, to tell a regex from a division.
    let previous = "";
    // Open template literals; each entry counts the braces of its ${...}.
    const templates: number[] = [];
    let index = 0;

    while (index < source.length) {
      const char = source[index]!;

      if (templates.length > 0 && templates.at(-1) === 0) {
        // Inside template text, outside any ${...}
        index = this.skipTemplateText(index, templates);
        previous = "`";
        continue;
      }

      if (/\s/.test(char)) {
        index++;
        continue;
      }

      if (source.startsWith("//", index)) {
        const end = source.indexOf("\n", index);
        index = end === -1 ? source.length : end + 1;
        continue;
      }

      if (source.startsWith("/*", index)) {
        const end = source.indexOf("*/", index + 2);
        index = end === -1 ? source.length : end + 2;
        continue;
      }

      if (char === '"' || char === "'") {
        index = skipQuoted(source, index);
        previous = char;
        continue;
      }

      if (char === "`") {
        templates.push(0);
        index++;
        continue;
      }

      if (char === "/" && startsRegex(previous)) {
        index = skipRegex(source, index);
        previous = "/";
        continue;
      }

      if (templates.length > 0) {
        if (char === "{") {
          templates[templates.length - 1]!++;
        } else if (char === "}") {
          templates[templates.length - 1]!--;
          if (templates.at(-1) === 0) {
            // End of ${...}: back to template text.
            index++;
            continue;
          }
        }
      }

      if (/[A-Za-z_$]/.test(char)) {
        let end = index + 1;
        while (end < source.length && /[\w$]/.test(source[end]!)) {
          end++;
        }
        const word = source.slice(index, end);
        if (previous !== ".") {
          handlers.onIdentifier(word, index);
        }
        previous = word;
        index = end;
        continue;
      }

      if (char === "(") {
        this.depth++;
      } else if (char === ")") {
        this.depth = Math.max(0, this.depth - 1);
        handlers.onCloseParen(this.depth);
      }

      previous = char;
      index++;
    }
  }

  /** Skip template text up to the closing backtick or the next `${`. */
  private skipTemplateText(from: number, templates: number[]): number {
    const source = this.source;
    let index = from;
    while (index < source.length) {
      const char = source[index]!;
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "`") {
        templates.pop();
        return index + 1;
      }
      if (char === "$" && source[index + 1] === "{") {
        templates[templates.length - 1] = 1;
        return index + 2;
      }
      index++;
    }
    return index;
  }
}

function startsRegex(previous: string): boolean {
  return previous === "" || REGEX_PRECEDERS.has(previous) || REGEX_KEYWORDS.has(previous);
}

function skipQuoted(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote || char === "\n") {
      return index + 1;
    }
    index++;
  }
  return index;
}

function skipRegex(source: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "\n") {
      return index;
    }
    if (inClass) {
      if (char === "]") inClass = false;
    } else if (char === "[") {
      inClass = true;
    } else if (char === "/") {
      index++;
      while (index < source.length && /[a-z]/i.test(source[index]!)) {
        index++;
      }
      return index;
    }
    index++;
  }
  return index;
}
