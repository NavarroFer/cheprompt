import assert from "node:assert/strict";
import test from "node:test";
import { mergeChangeKind, parseIgnoredPaths, reportableChangePath, resolveChangePath } from "../changes";

test("reports workspace files and hides internal or external paths", () => {
  assert.equal(reportableChangePath("/repo", "/repo/src/bot.ts"), "src/bot.ts");
  assert.equal(reportableChangePath("/repo", "/repo"), undefined);
  assert.equal(reportableChangePath("/repo", "/other/file.ts"), undefined);
  assert.equal(reportableChangePath("/repo", "/repo/.git/index"), undefined);
  assert.equal(reportableChangePath("/repo", "/repo/web/node_modules/pkg/index.js"), undefined);
});

test("only opens change paths that stay inside the workspace", () => {
  assert.equal(resolveChangePath("/repo", "src/bot.ts"), "/repo/src/bot.ts");
  assert.equal(resolveChangePath("/repo", "../secrets.txt"), undefined);
  assert.equal(resolveChangePath("/repo", "src/../../secrets.txt"), undefined);
  assert.equal(resolveChangePath("/repo", "/etc/hosts"), undefined);
  assert.equal(resolveChangePath("/repo", ".git/config"), undefined);
  assert.equal(resolveChangePath("/repo", ""), undefined);
});

test("keeps new files new while they change and treats recreation as a modification", () => {
  assert.equal(mergeChangeKind(undefined, "changed"), "changed");
  assert.equal(mergeChangeKind("created", "changed"), "created");
  assert.equal(mergeChangeKind("deleted", "created"), "changed");
  assert.equal(mergeChangeKind("changed", "deleted"), "deleted");
});

test("parses git check-ignore output into a path set", () => {
  assert.deepEqual([...parseIgnoredPaths(".next/cache.json\r\ncoverage/lcov.info\n\n")], [".next/cache.json", "coverage/lcov.info"]);
});
