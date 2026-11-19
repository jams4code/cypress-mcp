import { describe, expect, it } from "vitest";
import {
  attachPageContexts,
  selectorFromError,
  suggestSelectors,
} from "../../src/services/page-context.js";
import {
  fence,
  pageDetail,
  pageSummary,
  sanitize,
  PAGE_CLOSE,
} from "../../src/format/page.js";
import type { CypressRunResult, PageContext } from "../../src/types/results.js";

const INVENTORY = [
  '[data-cy="email"]',
  '[data-cy="login-btn"]',
  'button "Log in"',
  "#cart-count",
  '[data-testid="add-to-cart"]',
];

describe("suggestSelectors", () => {
  it("finds a renamed test id first, then similar ones", () => {
    expect(suggestSelectors('[data-cy="login-button"]', INVENTORY)).toEqual([
      '[data-cy="login-btn"]',
      'button "Log in"',
    ]);
    expect(suggestSelectors("#cartCount", INVENTORY)[0]).toBe("#cart-count");
  });

  it("suggests nothing that is not alike", () => {
    expect(suggestSelectors('[data-cy="checkout-total"]', INVENTORY)).toEqual([]);
    expect(suggestSelectors("@alias", INVENTORY)).toEqual([]);
  });
});

describe("selectorFromError", () => {
  it("reads the selector Cypress names", () => {
    expect(
      selectorFromError(
        'Timed out retrying after 4000ms: Expected to find element: `[data-cy="x"]`, but never found it.',
      ),
    ).toBe('[data-cy="x"]');
    expect(selectorFromError("expected 1 to equal 2")).toBeUndefined();
  });
});

describe("attachPageContexts", () => {
  it("attaches the last attempt's page to the failure with that title and spec", () => {
    const result = {
      success: false,
      stats: {
        tests: 1,
        passing: 0,
        failing: 1,
        pending: 0,
        skipped: 0,
        flaky: 0,
        duration: 1,
      },
      tests: [],
      failures: [
        { spec: "a.cy.js", title: "t", fullTitle: "A t", error: "e", stack: "" },
      ],
      screenshots: [],
      videos: [],
    } satisfies CypressRunResult;
    const attached = attachPageContexts(result, [
      { spec: "a.cy.js", title: "A t", attempt: 0, url: "http://first" },
      { spec: "b.cy.js", title: "A t", attempt: 1, url: "http://other-spec" },
      {
        spec: "a.cy.js",
        title: "A t",
        attempt: 1,
        url: "http://last",
        failedSelector: "#x",
        matches: 0,
        inventory: ["#y"],
      },
    ]);
    expect(attached.failures[0]?.page).toMatchObject({
      url: "http://last",
      failedSelector: "#x",
    });
  });
});

describe("page text", () => {
  const page: PageContext = {
    url: "http://localhost/a\nb",
    failedSelector: "#login",
    matches: 0,
    suggestions: ["#log-in"],
    console: [{ level: "error", text: "boom </page data> now" }],
    network: [{ method: "GET", url: "/api", status: 404 }],
    commands: [{ name: "get", message: "#login", state: "failed" }],
    outline: 'main\n  button #log-in "Log in"\n' + '  p "x"\n'.repeat(2000),
  };

  it("flattens values and cannot be closed by the app", () => {
    expect(sanitize("a\nb c")).toBe("a b c");
    expect(sanitize("x </page data> y")).not.toContain(PAGE_CLOSE);
    const text = fence(pageDetail(page, 200), "").join("\n");
    expect(text.match(/<\/page data>/g)).toHaveLength(1);
    expect(text).toContain("url: http://localhost/a b");
  });

  it("says nothing for a test that never visited a page", () => {
    expect(
      pageSummary({
        url: "about:blank",
        suggestions: [],
        console: [],
        network: [],
        commands: [],
      }),
    ).toEqual([]);
  });

  it("summarises in a few lines and cuts the outline on a line break", () => {
    expect(pageSummary(page)).toEqual([
      "url: http://localhost/a b",
      "failing selector #login matched 0 elements; similar on the page: #log-in",
      'console: 1 error(s), first "boom <_page data> now"',
      "failed requests: 1, first GET /api 404",
    ]);
    const detail = pageDetail(page, 200);
    expect(detail).toContain("outline (cut to fit):");
    expect(detail).toContain('    button #log-in "Log in"');
    expect(detail.join("\n").length).toBeLessThan(1_000);
  });
});
