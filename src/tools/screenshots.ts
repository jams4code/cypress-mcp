// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// Screenshots reach the agent as resource links by default (a few tokens
// each); the image itself, scaled to 1,000 px wide, only when asked for. The
// links point at a resource template this server reads, so clients without
// file access (Claude Desktop, cloud agents) can still open them.
import path from "node:path";
import {
  ResourceTemplate,
  type ContentBlock,
  type McpServer,
} from "@modelcontextprotocol/server";
import type { ToolContext } from "../types/index.js";
import type { RunRecord } from "../services/state-store.js";
import { IMAGE_WIDTH, scaledScreenshot } from "../utils/png.js";

const TEMPLATE = "cypress-mcp://runs/{runId}/screenshots/{index}";

/** Links listed in one result; the text names every screenshot anyway. */
export const MAX_LINKS = 10;
/** Images in one result: each costs about 700 image tokens at 1,000 px. */
export const MAX_IMAGES = 3;

export function screenshotUri(runId: string, index: number): string {
  return `cypress-mcp://runs/${encodeURIComponent(runId)}/screenshots/${index}`;
}

/** Resource links for the given screenshot files of a run. */
export function screenshotLinks(
  record: RunRecord,
  files: readonly (string | undefined)[],
  label: (file: string, position: number) => string,
): ContentBlock[] {
  const links: ContentBlock[] = [];
  files.forEach((file, position) => {
    if (!file || links.length >= MAX_LINKS) return;
    const index = record.result.screenshots.indexOf(file);
    if (index === -1) return;
    links.push({
      type: "resource_link",
      uri: screenshotUri(record.runId, index),
      name: path.basename(file),
      mimeType: "image/png",
      description: label(file, position),
    });
  });
  return links;
}

/** Image content, scaled, for up to MAX_IMAGES files. */
export async function screenshotImages(
  files: readonly string[],
): Promise<ContentBlock[]> {
  const images: ContentBlock[] = [];
  for (const file of files.slice(0, MAX_IMAGES)) {
    const image = await scaledScreenshot(file, IMAGE_WIDTH);
    if (image) {
      images.push({ type: "image", data: image.data, mimeType: image.mimeType });
    }
  }
  return images;
}

/**
 * resources/read for the links above. Only screenshots of runs this server
 * recorded can be read: the URI carries a runId and an index, never a path.
 */
export function registerScreenshotResources(server: McpServer, ctx: ToolContext): void {
  server.registerResource(
    "screenshot",
    new ResourceTemplate(TEMPLATE, { list: undefined }),
    {
      title: "Cypress failure screenshot",
      description: `A screenshot Cypress took during a run, scaled to ${IMAGE_WIDTH} px wide.`,
      mimeType: "image/png",
    },
    async (uri, variables) => {
      const runId = String(variables["runId"] ?? "");
      const index = Number(variables["index"]);
      const record = ctx.stateStore.getRun(decodeURIComponent(runId));
      const file =
        record && Number.isInteger(index) ? record.result.screenshots[index] : undefined;
      const image = file ? await scaledScreenshot(file, IMAGE_WIDTH) : undefined;
      if (!image) {
        throw new Error(
          `No screenshot at ${uri.href}: the run is unknown to this server or its files were deleted.`,
        );
      }
      return {
        contents: [{ uri: uri.href, mimeType: image.mimeType, blob: image.data }],
      };
    },
  );
}
