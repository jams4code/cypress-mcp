// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import { z } from "zod";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../types/index.js";
import { LAST_RUN, type RunRecord } from "../services/state-store.js";
import {
  buildFailureContexts,
  type FailureContext,
} from "../services/failure-context.js";
import { displayPath } from "../services/projects.js";
import { InvalidArgumentError, RunNotFoundError } from "../utils/errors.js";
import {
  FAILURES_PER_PAGE,
  renderFailureContexts,
  renderOutput,
  renderPage,
  renderScreenshots,
  renderTests,
  relative,
} from "../format/compact.js";
import { EXCERPT_RADIUS, pageData, pageSchema } from "./run.js";
import {
  READ_ONLY,
  envelopeSchema,
  errorResult,
  textResult,
  type Envelope,
} from "./result.js";
import { screenshotImages, screenshotLinks } from "./screenshots.js";

const TOOL = "cypress_get_failure";

const VIEWS = ["failures", "page", "tests", "screenshots", "output"] as const;
type View = (typeof VIEWS)[number];

const failureDataSchema = z.object({
  view: z.enum(VIEWS),
  spec: z.string(),
  failureCount: z.number(),
  contextCaptured: z.boolean(),
  failures: z
    .array(
      z.object({
        index: z.number(),
        spec: z.string(),
        title: z.string(),
        fullTitle: z.string(),
        errorName: z.string().optional(),
        error: z.string(),
        location: z.string().optional(),
        diff: z.string().optional(),
        screenshot: z.string().optional(),
        excerpt: z.string().optional(),
        stack: z.string(),
        page: pageSchema.optional(),
      }),
    )
    .optional(),
  tests: z
    .array(
      z.object({
        spec: z.string().optional(),
        title: z.string(),
        fullTitle: z.string(),
        state: z.enum(["passed", "failed", "pending", "skipped"]),
        duration: z.number(),
        attempts: z.number(),
        flaky: z.boolean(),
      }),
    )
    .optional(),
  screenshots: z.array(z.string()).optional(),
  missingScreenshots: z.number().optional(),
  stdoutTail: z.string().optional(),
  stderrTail: z.string().optional(),
  error: z.string().optional(),
  errorKind: z.enum(["compile", "timeout"]).optional(),
  runningTest: z.string().optional(),
});

type FailureData = z.infer<typeof failureDataSchema>;
type EnvelopeOf = (summary: string, data: FailureData, nextActions: string[]) => Envelope;

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "Inspect a Cypress run",
      description:
        'Details of a run from cypress_run. view "failures" (default): each failure with source excerpt, error, diff, stack, screenshot. "page": the page at one failure (DOM/ARIA outline, URL, console and network errors, command log, similar selectors). "tests": every test. "screenshots": image links. "output": the end of Cypress\'s output.',
      inputSchema: z.object({
        runId: z
          .string()
          .min(1)
          .default(LAST_RUN)
          .describe(
            'runId returned by cypress_run. "last" is the latest run of this server, which can be another agent\'s.',
          ),
        view: z.enum(VIEWS).default("failures"),
        failure: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .optional()
          .describe("Only this failure, by its number in the run result"),
        image: z
          .boolean()
          .optional()
          .describe("Add the screenshots as images, scaled to 1000 px wide"),
      }),
      outputSchema: envelopeSchema(failureDataSchema),
      annotations: READ_ONLY,
    },
    async ({ runId, view, failure, image }) => {
      try {
        const record = ctx.stateStore.getRun(runId);
        if (!record) {
          throw new RunNotFoundError(runId, ctx.stateStore.runIds());
        }
        return await inspect(ctx, record, view, failure, image === true);
      } catch (err) {
        return errorResult(TOOL, err, ctx.logger);
      }
    },
  );
}

async function inspect(
  ctx: ToolContext,
  record: RunRecord,
  view: View,
  failure: number | undefined,
  image: boolean,
): Promise<CallToolResult> {
  const { result } = record;
  const show = (file: string): string => displayPath(record.prefix, file);
  const base: FailureData = {
    view,
    spec: show(record.spec),
    failureCount: result.failures.length,
    contextCaptured: record.contextCaptured,
    ...(result.error ? { error: result.error } : {}),
    ...(result.errorKind ? { errorKind: result.errorKind } : {}),
    ...(result.runningTest ? { runningTest: result.runningTest } : {}),
  };
  const envelope: EnvelopeOf = (summary, data, nextActions) => ({
    ok: true,
    tool: TOOL,
    runId: record.runId,
    summary,
    data,
    nextActions,
  });
  const runRef = `{"runId":"${record.runId}"`;
  const firstLine = (text: string): string => text.split("\n", 1)[0]!;
  const withMedia = async (
    response: CallToolResult,
    files: readonly (string | undefined)[],
  ): Promise<CallToolResult> => {
    const present = files.filter((file): file is string => Boolean(file));
    response.content.push(
      ...screenshotLinks(
        record,
        files,
        (file) => `Screenshot ${relative(ctx.serverRoot, file)}`,
      ),
      ...(image ? await screenshotImages(present) : []),
    );
    return response;
  };

  switch (view) {
    case "failures":
    case "page": {
      const all = await buildFailureContexts(record, record.projectRoot, EXCERPT_RADIUS);
      if (failure !== undefined && failure > all.length) {
        throw new InvalidArgumentError(
          `failure ${failure} does not exist: run ${record.runId} has ${all.length} failure(s).`,
        );
      }

      if (view === "page") {
        return pageView(record, all, failure ?? 1, envelope, base, withMedia);
      }

      const first = failure ?? 1;
      const shown =
        failure !== undefined
          ? all.slice(failure - 1, failure)
          : all.slice(0, FAILURES_PER_PAGE);
      const nextActions: string[] = [];
      const after = first + shown.length;
      if (failure === undefined && all.length >= after) {
        nextActions.push(
          `failures ${after} to ${all.length}: cypress_get_failure ${runRef},"failure":${after}}`,
        );
      }
      if (shown.some((f) => f.page?.outline)) {
        nextActions.push(
          `the page outline: cypress_get_failure ${runRef},"view":"page","failure":${shown.find((f) => f.page?.outline)!.index}}`,
        );
      }
      if (result.error && !result.errorKind) {
        nextActions.push(
          `cypress_get_failure ${runRef},"view":"output"} for Cypress's output`,
        );
      }
      const text = renderFailureContexts(record, shown, {
        displayRoot: ctx.serverRoot,
        first,
        total: all.length,
        nextActions,
      });
      const failures = shown.map((context) => failureData(context, show));
      return withMedia(
        textResult(text, envelope(firstLine(text), { ...base, failures }, nextActions)),
        shown.map((context) => context.screenshot),
      );
    }

    case "tests": {
      const text = renderTests(record, []);
      const tests = result.tests.map((test) => ({
        ...(test.spec ? { spec: show(test.spec) } : {}),
        title: test.title,
        fullTitle: test.fullTitle,
        state: test.state,
        duration: test.duration,
        attempts: test.attempts,
        flaky: test.flaky,
      }));
      return textResult(text, envelope(firstLine(text), { ...base, tests }, []));
    }

    case "screenshots": {
      const existing: string[] = [];
      for (const file of result.screenshots) {
        try {
          await fs.access(file);
          existing.push(file);
        } catch {
          // Deleted since the run; counted below.
        }
      }
      const missing = result.screenshots.length - existing.length;
      const text = renderScreenshots(record, existing, missing, {
        displayRoot: ctx.serverRoot,
        nextActions: [],
      });
      return withMedia(
        textResult(
          text,
          envelope(
            firstLine(text),
            {
              ...base,
              screenshots: existing,
              ...(missing > 0 ? { missingScreenshots: missing } : {}),
            },
            [],
          ),
        ),
        existing,
      );
    }

    case "output": {
      const text = renderOutput(record, []);
      return textResult(
        text,
        envelope(
          firstLine(text),
          {
            ...base,
            stdoutTail: record.stdoutTail,
            stderrTail: record.stderrTail,
          },
          [],
        ),
      );
    }
  }
}

/** The page view: everything the browser recorded at one failure. */
function pageView(
  record: RunRecord,
  all: readonly FailureContext[],
  index: number,
  envelope: EnvelopeOf,
  base: FailureData,
  withMedia: (
    response: CallToolResult,
    files: readonly (string | undefined)[],
  ) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const context = all[index - 1];
  if (!context) {
    throw new InvalidArgumentError(
      `Run ${record.runId} has no failure, so no page to show.`,
    );
  }
  if (!context.page) {
    throw new InvalidArgumentError(
      record.contextCaptured
        ? `No page was recorded for failure ${index}: the test failed outside a page (a hook before cy.visit, an error in Node), or the app is on another origin.`
        : `No page was recorded for run ${record.runId}: failure context was off (failureContext: false, or the wrapper config could not load).`,
    );
  }
  const show = (file: string): string => displayPath(record.prefix, file);
  const text = renderPage(record, context, { total: all.length, nextActions: [] });
  return withMedia(
    textResult(
      text,
      envelope(
        text.split("\n", 1)[0]!,
        { ...base, failures: [failureData(context, show)] },
        [],
      ),
    ),
    [context.screenshot],
  );
}

function failureData(context: FailureContext, show: (file: string) => string) {
  const { stackHint: _stackHint, page, ...rest } = context;
  return {
    ...rest,
    spec: show(rest.spec),
    ...(rest.location ? { location: show(rest.location) } : {}),
    ...(page ? { page: pageData(page) } : {}),
  };
}
