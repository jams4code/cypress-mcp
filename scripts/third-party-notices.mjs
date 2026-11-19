// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
//
// Writes dist/THIRD_PARTY_NOTICES.md: the license of every package bundled
// into dist/index.js. Since 0.3.0 the dependencies ship inside the bundle
// instead of being installed by npm, so their notices must ship with it.
//
// Reads the esbuild metafile tsup writes (dist/metafile-esm.json). Packages
// that a bundled package itself vendors (the MCP SDK ships ajv in its dist)
// are found from the `//#region` markers its bundler leaves.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const metafilePath = path.join(root, "dist", "metafile-esm.json");

/** Package names bundled into dist/index.js, with the packages they vendor. */
export function bundledPackages(metafile = readMetafile()) {
  const direct = new Set();
  const vendored = new Map();

  for (const [input, info] of Object.entries(metafile.outputs["dist/index.js"].inputs)) {
    if (info.bytesInOutput === 0) continue;
    const name = packageOf(input);
    if (!name) continue;
    direct.add(name);

    const source = readFileSync(path.join(root, input), "utf8");
    for (const match of source.matchAll(/\/\/#region \S*node_modules\/((?:@[^/\s]+\/)?[^/\s]+)/g)) {
      const inner = match[1];
      if (inner !== name && !direct.has(inner)) {
        vendored.set(inner, name);
      }
    }
  }
  for (const name of direct) vendored.delete(name);
  return { direct: [...direct].sort(), vendored };
}

function readMetafile() {
  if (!existsSync(metafilePath)) {
    throw new Error(`${metafilePath} is missing: run the build (tsup) first.`);
  }
  return JSON.parse(readFileSync(metafilePath, "utf8"));
}

/** `node_modules/@scope/name/x.js` to `@scope/name`; undefined for our own sources. */
function packageOf(input) {
  const at = input.lastIndexOf("node_modules/");
  if (at === -1) return undefined;
  const parts = input.slice(at + "node_modules/".length).split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENCE", "LICENSE-MIT"];

function describe(name) {
  const dir = path.join(root, "node_modules", name);
  if (!existsSync(path.join(dir, "package.json"))) {
    return undefined;
  }
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const licenseFile = LICENSE_FILES.map((file) => path.join(dir, file)).find(existsSync);
  return {
    version: pkg.version,
    license: typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license),
    text: licenseFile ? readFileSync(licenseFile, "utf8").trim() : undefined,
  };
}

function render({ direct, vendored }) {
  const lines = [
    "# Third-party notices",
    "",
    "dist/index.js bundles the packages below. Each is used under its own license, reproduced here.",
    "",
  ];

  for (const name of direct) {
    const info = describe(name);
    lines.push(`## ${name}${info ? ` ${info.version}` : ""}`, "");
    lines.push(`License: ${info?.license ?? "see the package"}`, "");
    if (info?.text) lines.push("```", info.text, "```", "");
  }

  if (vendored.size > 0) {
    lines.push(
      "## Packages vendored inside bundled packages",
      "",
      "These ship inside the dist of the package named in brackets. License texts are those of the version installed with this project's dependencies.",
      "",
    );
    for (const [name, host] of [...vendored].sort(([a], [b]) => a.localeCompare(b))) {
      const info = describe(name);
      lines.push(`### ${name} (in ${host})`, "");
      lines.push(`License: ${info?.license ?? "MIT, per the vendoring package's sources"}`, "");
      if (info?.text) lines.push("```", info.text, "```", "");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const packages = bundledPackages();
  writeFileSync(path.join(root, "dist", "THIRD_PARTY_NOTICES.md"), render(packages));
  console.log(
    `THIRD_PARTY_NOTICES.md: ${packages.direct.length} bundled, ${packages.vendored.size} vendored`,
  );
}
