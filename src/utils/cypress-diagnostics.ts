// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
const DIAGNOSTIC_PATTERN =
  /(your configfile is invalid|configfile is invalid|error \[err_|cannot find module|cannot find|syntaxerror|referenceerror|typeerror|exception|failed)/i;

const CONFIG_INVALID_PATTERN =
  /(your configfile is invalid|configfile is invalid|it threw an error when required|error \[err_|cannot find module)/i;

const MISSING_SPEC_PATTERN =
  /(no spec files were found|a spec file was requested but not found|we searched for specs matching)/i;

export interface RuntimeCheckResult {
  readonly status: "ok" | "warn" | "fail";
  readonly detail: string;
}

export function extractDiagnosticSnippet(stdout: string, stderr: string): string {
  const stderrSnippet = findDiagnosticWindow(stderr);
  if (stderrSnippet) {
    return stderrSnippet;
  }

  const stdoutSnippet = findDiagnosticWindow(stdout);
  if (stdoutSnippet) {
    return stdoutSnippet;
  }

  const fallback = stderr.trim() || stdout.trim();
  return trimSnippet(fallback);
}

export function classifyConfigRuntimeCheck(
  exitCode: number | null,
  stdout: string,
  stderr: string,
): RuntimeCheckResult {
  const combined = `${stderr}\n${stdout}`;

  if (CONFIG_INVALID_PATTERN.test(combined)) {
    return {
      status: "fail",
      detail: extractDiagnosticSnippet(stdout, stderr),
    };
  }

  if (exitCode === 0 || MISSING_SPEC_PATTERN.test(combined)) {
    return {
      status: "ok",
      detail: "Cypress was able to load the config file.",
    };
  }

  return {
    status: "warn",
    detail: extractDiagnosticSnippet(stdout, stderr),
  };
}

function findDiagnosticWindow(output: string): string | null {
  const lines = output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());

  const lineIndex = lines.findIndex((line) => DIAGNOSTIC_PATTERN.test(line));
  if (lineIndex === -1) {
    return null;
  }

  const start = Math.max(0, lineIndex - 2);
  const end = Math.min(lines.length, lineIndex + 6);
  const window = lines
    .slice(start, end)
    .filter((line) => line.length > 0)
    .join("\n");

  return trimSnippet(window);
}

function trimSnippet(value: string): string {
  if (value.length <= 2000) {
    return value;
  }

  return value.slice(0, 2000);
}
