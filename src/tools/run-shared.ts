// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { ServerContext } from "@modelcontextprotocol/server";
import type { ToolContext } from "../types/index.js";
import type { CloudRecordArgs, CypressRunArgs } from "../types/cypress.js";
import type { RunProgress } from "../services/reporter-events.js";
import { InvalidArgumentError } from "../utils/errors.js";
import { resolveTargets } from "../services/targets.js";

// Descriptions and constraints are kept short: every tool definition is sent
// to the model, and this shape is in each run tool. Limits that only guard
// against nonsense (tag lengths, ids) are checked in validateCloud instead.

/** Input fields shared by every tool that starts a Cypress run. */
export const runOptionsShape = {
  browser: z
    .string()
    .optional()
    .describe(
      "Browser from `cypress info`: chrome, firefox, edge, electron, chrome:beta... Default: the project's",
    ),
  headed: z.boolean().optional().describe("Show the browser"),
  timeout: z
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .optional()
    .describe("ms, default 300000"),
  env: z.record(z.string(), z.string()).optional().describe("Cypress env values"),
};

/**
 * Cypress Cloud recording. The record key never appears here: Cypress reads
 * CYPRESS_RECORD_KEY from the server environment.
 */
export const cloudOptionsShape = {
  record: z
    .boolean()
    .optional()
    .describe(
      "Record to Cypress Cloud (needs projectId and CYPRESS_RECORD_KEY in the server env)",
    ),
  tags: z.array(z.string()).optional().describe("Cloud run tags"),
  group: z.string().optional().describe("Cloud run group"),
  ciBuildId: z.string().optional().describe("Cloud build id"),
};

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 100;
const MAX_CLOUD_ID_LENGTH = 200;

/** Limits the schema leaves out, with messages the agent can act on. */
function validateRunInput(input: RunInput): void {
  if (
    input.repeat !== undefined &&
    (!Number.isInteger(input.repeat) || input.repeat < 1 || input.repeat > MAX_REPEAT)
  ) {
    throw new InvalidArgumentError(
      `repeat must be a whole number from 1 to ${MAX_REPEAT}.`,
    );
  }
  for (const key of Object.keys(input.env ?? {})) {
    if (key.length === 0) {
      throw new InvalidArgumentError("env keys must not be empty.");
    }
  }
  const tags = input.tags ?? [];
  if (tags.length > MAX_TAGS) {
    throw new InvalidArgumentError(`At most ${MAX_TAGS} tags, got ${tags.length}.`);
  }
  for (const tag of tags) {
    if (tag.trim() === "" || tag.includes(",") || tag.length > MAX_TAG_LENGTH) {
      throw new InvalidArgumentError(
        `Tags must be 1 to ${MAX_TAG_LENGTH} characters without commas: ${JSON.stringify(tag)}`,
      );
    }
  }
  for (const [name, value] of [
    ["group", input.group],
    ["ciBuildId", input.ciBuildId],
  ] as const) {
    if (
      value !== undefined &&
      (value.trim() === "" || value.length > MAX_CLOUD_ID_LENGTH)
    ) {
      throw new InvalidArgumentError(
        `${name} must be 1 to ${MAX_CLOUD_ID_LENGTH} characters.`,
      );
    }
  }
}

export interface RunInput {
  /** A spec path, `path:line`, a glob, or several of those */
  spec: string | string[];
  testName?: string;
  /** Project folder under the server root (monorepos) */
  project?: string;
  component?: boolean;
  repeat?: number;
  browser?: string;
  headed?: boolean;
  timeout?: number;
  env?: Record<string, string>;
  record?: boolean;
  tags?: string[];
  group?: string;
  ciBuildId?: string;
}

/** A prepared run: the project it belongs to and the arguments for Cypress. */
export interface PreparedRun {
  readonly ctx: ToolContext;
  /** Project folder relative to the server root, "" at the root */
  readonly prefix: string;
  /** Spec files, project relative */
  readonly specs: readonly string[];
  readonly args: CypressRunArgs;
}

export const MAX_REPEAT = 50;

export function toCloudArgs(input: {
  record?: boolean;
  tags?: string[];
  group?: string;
  ciBuildId?: string;
}): CloudRecordArgs | undefined {
  if (!input.record) {
    return undefined;
  }
  return {
    record: true,
    tags: input.tags,
    group: input.group,
    ciBuildId: input.ciBuildId,
  };
}

/**
 * Find the project and the specs, check the browser, then build the
 * `cypress run` arguments. Throws CypressMcpError for anything the caller can
 * fix. Title filters are checked when the run starts: with the wrapper config
 * they need no plugin.
 */
export async function prepareRun(
  root: ToolContext,
  input: RunInput,
): Promise<PreparedRun> {
  validateRunInput(input);
  const inputs = Array.isArray(input.spec) ? input.spec : [input.spec];
  const {
    ctx,
    prefix,
    specs: projectSpecs,
  } = await root.projects.select({
    project: input.project,
    specs: inputs,
  });
  const targets = await resolveTargets(ctx, projectSpecs);
  if (targets.titles && input.testName !== undefined) {
    throw new InvalidArgumentError(
      "Use either testName or a file:line target, not both: file:line already picks the test.",
    );
  }
  const config = await ctx.configLoader.load();

  return {
    ctx,
    prefix,
    specs: targets.specs,
    args: {
      spec: targets.cypressSpec,
      browser:
        input.browser === undefined
          ? config.defaultBrowser
          : await ctx.processManager.resolveBrowser(input.browser),
      headed: input.headed,
      timeout: input.timeout ?? config.defaultTimeout,
      env: input.env,
      grep: input.testName,
      ...(targets.titles ? { titles: targets.titles } : {}),
      ...(input.repeat !== undefined && input.repeat > 1 ? { repeat: input.repeat } : {}),
      ...(input.component ? { component: true } : {}),
      configFile: config.cypressConfigFile,
      cloud: toCloudArgs(input),
    },
  };
}

export interface ProgressNotifier {
  /** Undefined when the client did not ask for progress */
  readonly onProgress?: (progress: RunProgress) => void;
  /**
   * Resolves once every notification sent so far is written. Call it before
   * returning the result: a client drops progress that arrives after the
   * response, and a fast run reports several tests in one stdout chunk.
   */
  flush(): Promise<void>;
}

/**
 * Sends `notifications/progress` for the request when the client asked for
 * progress (gave a progressToken). Each notification carries a higher
 * progress value than the last, as the protocol requires.
 */
export function progressNotifier(request?: ServerContext): ProgressNotifier {
  const progressToken = request?.mcpReq._meta?.progressToken;
  if (!request || progressToken === undefined) {
    return { flush: () => Promise.resolve() };
  }

  const pending = new Set<Promise<void>>();
  let last = -1;
  const onProgress = (progress: RunProgress): void => {
    if (progress.completed <= last) {
      return;
    }
    last = progress.completed;
    const sent = request.mcpReq
      .notify({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: progress.completed,
          ...(progress.total === undefined ? {} : { total: progress.total }),
          message: progress.message,
        },
      })
      .catch(() => {
        // The client went away; the run itself is unaffected.
      });
    pending.add(sent);
    void sent.finally(() => pending.delete(sent));
  };

  return {
    onProgress,
    flush: async () => {
      await Promise.all([...pending]);
    },
  };
}
