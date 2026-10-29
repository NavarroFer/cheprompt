import { isAbsolute, join, relative, sep } from "node:path";

export type WorkspaceChangeKind = "created" | "changed" | "deleted";

export interface WorkspaceChange {
  path: string;
  kind: WorkspaceChangeKind;
}

const INTERNAL_SEGMENTS = new Set([".git", "node_modules"]);

export function reportableChangePath(root: string, filePath: string): string | undefined {
  const path = relative(root, filePath);
  if (!path || path.startsWith("..") || isAbsolute(path)) return undefined;
  const segments = path.split(sep);
  if (segments.some((segment) => INTERNAL_SEGMENTS.has(segment))) return undefined;
  return segments.join("/");
}

export function resolveChangePath(root: string, path: string): string | undefined {
  if (!path || isAbsolute(path)) return undefined;
  const filePath = join(root, path);
  return reportableChangePath(root, filePath) === path.split(sep).join("/") ? filePath : undefined;
}

export function mergeChangeKind(
  previous: WorkspaceChangeKind | undefined,
  next: WorkspaceChangeKind,
): WorkspaceChangeKind {
  // A file created during the run stays new while it keeps changing; one recreated after deletion was modified.
  if (previous === "created" && next === "changed") return "created";
  if (previous === "deleted" && next === "created") return "changed";
  return next;
}

export function parseIgnoredPaths(stdout: string): Set<string> {
  return new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}
