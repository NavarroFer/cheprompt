import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessExecutionOptions, ProcessExecutor, ProcessResult } from "../opencode";
import { GitWorktreeManager } from "../worktree";

class FakeGit implements ProcessExecutor {
  calls: Array<{ executable: string; args: readonly string[]; options?: ProcessExecutionOptions }> = [];
  statusOutput = "";
  exitCode = 0;

  async run(executable: string, args: readonly string[], options?: ProcessExecutionOptions): Promise<ProcessResult> {
    this.calls.push({ executable, args, options });
    if (args[0] === "rev-parse") {
      return {
        stdout: args[1] === "HEAD" ? `${"a".repeat(40)}\n` : "/repo\n",
        stderr: "",
        exitCode: this.exitCode,
      };
    }
    if (args[0] === "status") return { stdout: this.statusOutput, stderr: "", exitCode: this.exitCode };
    return { stdout: "", stderr: "", exitCode: this.exitCode };
  }
}

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeStorageDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cheprompt-worktree-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

test("worktree manager requires a clean Git workspace before parallel execution", async () => {
  const git = new FakeGit();
  const manager = new GitWorktreeManager(git);
  await assert.rejects(() => manager.resolveCleanRepository(undefined), /Abrí una carpeta/);
  git.statusOutput = " M src/extension.ts\n";
  await assert.rejects(() => manager.resolveCleanRepository("/repo"), /Guardá o descartá/);
  git.statusOutput = "";
  assert.deepEqual(await manager.resolveCleanRepository("/repo"), { root: "/repo", head: "a".repeat(40) });
});

test("worktree manager creates detached worktrees and removes only managed paths", async () => {
  const git = new FakeGit();
  const manager = new GitWorktreeManager(git);
  const storage = await makeStorageDirectory();
  const baseCommit = "a".repeat(40);
  const worktree = await manager.createWorktree("/repo", storage, "run-1", "task-1", baseCommit);
  assert.equal(worktree, join(storage, "worktrees", "run-1", "task-1"));
  assert.deepEqual(git.calls.at(-1)?.args, ["worktree", "add", "--detach", worktree, baseCommit]);
  await assert.rejects(() => manager.removeWorktree("/repo", storage, "/repo"), /fuera del espacio/);
  await manager.removeWorktree("/repo", storage, worktree);
  assert.deepEqual(git.calls.at(-1)?.args, ["worktree", "remove", worktree]);
});

test("worktree manager reports failed Git operations without leaking diagnostics", async () => {
  const git = new FakeGit();
  git.exitCode = 1;
  const manager = new GitWorktreeManager(git);
  await assert.rejects(() => manager.resolveCleanRepository("/repo"), /repositorio Git abierto/);
  git.exitCode = 0;
  git.statusOutput = "";
  const storage = await makeStorageDirectory();
  git.run = async (executable, args, options) => {
    git.calls.push({ executable, args, options });
    return { stdout: "", stderr: "private path detail", exitCode: 1 };
  };
  await assert.rejects(() => manager.createWorktree("/repo", storage, "run", "task", "b".repeat(40)), /No se pudo crear/);
});
