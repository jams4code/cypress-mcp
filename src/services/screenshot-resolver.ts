import { glob } from "tinyglobby";
import path from "node:path";
import fs from "node:fs/promises";
import { normalizePath } from "../utils/paths.js";
import type { Logger } from "../utils/logger.js";

export class ScreenshotResolver {
  constructor(
    private readonly projectRoot: string,
    private readonly screenshotsDir: string,
    private readonly logger: Logger,
  ) {}

  /** Find screenshots matching a spec name or test name */
  async find(spec?: string, testName?: string): Promise<string[]> {
    const dir = path.join(this.projectRoot, this.screenshotsDir);

    try {
      await fs.access(dir);
    } catch {
      return [];
    }

    const pattern = "**/*.png";
    const allFiles = await glob([pattern], {
      cwd: dir,
      absolute: true,
    });

    let filtered = allFiles.map(normalizePath);

    if (spec) {
      const specBase = path.basename(spec, path.extname(spec));
      filtered = filtered.filter((f) => f.includes(specBase));
    }

    if (testName) {
      const sanitized = testName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      filtered = filtered.filter((f) => {
        const fileName = path.basename(f).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        return fileName.includes(sanitized);
      });
    }

    // Sort by modification time (newest first)
    const withStats = await Promise.all(
      filtered.map(async (f) => {
        try {
          const stat = await fs.stat(f);
          return { path: f, mtime: stat.mtimeMs };
        } catch {
          return { path: f, mtime: 0 };
        }
      }),
    );

    return withStats.sort((a, b) => b.mtime - a.mtime).map((s) => s.path);
  }
}
