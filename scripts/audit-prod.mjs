// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
//
// Audit of the code that ships, for CI. Since 0.3.0 the runtime dependencies
// are bundled into dist/index.js and are devDependencies in package.json, so
// `npm audit --omit=dev` would see nothing. This runs `npm audit` on the whole
// tree and fails on moderate and above for any package that is in the bundle
// (read from the build's metafile, so run it after `npm run build`).
//
// Advisories listed in audit-allowlist.json are skipped until their `until`
// date. An expired entry fails the gate, so nothing stays ignored by accident.
//
// Packages that a bundled package vendors inside its own dist (the MCP SDK
// ships ajv) are not in npm's tree, so npm audit cannot see them; they are
// listed with their licenses in dist/THIRD_PARTY_NOTICES.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { bundledPackages } from "./third-party-notices.mjs";

const FAILING = new Set(["moderate", "high", "critical"]);
const today = new Date().toISOString().slice(0, 10);

const allowlist = JSON.parse(
  readFileSync(new URL("../audit-allowlist.json", import.meta.url)),
);
const allowed = new Map();
let failed = false;
for (const entry of allowlist) {
  if (entry.until < today) {
    console.error(`Allowlist entry ${entry.id} expired on ${entry.until}: review it.`);
    failed = true;
  } else {
    allowed.set(entry.id, entry);
  }
}

const bundled = new Set(bundledPackages().direct);
console.log(`Bundled packages: ${[...bundled].join(", ")}`);

let raw;
try {
  raw = execFileSync("npm", ["audit", "--json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
} catch (err) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  raw = err.stdout;
}
const report = JSON.parse(raw);

const seen = new Set();
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (!bundled.has(name)) continue;
  for (const via of vuln.via) {
    // String entries point at another package whose advisory is listed on its own.
    if (typeof via === "string" || !FAILING.has(via.severity)) continue;
    const id = via.url.split("/").pop();
    if (seen.has(id)) continue;
    seen.add(id);
    if (allowed.has(id)) {
      console.log(`allowed  ${id} ${via.name}: ${allowed.get(id).reason}`);
    } else {
      console.error(`FAIL     ${id} ${via.severity} ${via.name}: ${via.title}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log("Audit of the bundled packages passed.");
