import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { NodeProcessExecutor, ProcessExecutor } from "./opencode";

export interface CleanRepository {
  root: string;
  head: string;
}

export class GitWorktreeManager {
  constructor(
    private readonly processExecutor: ProcessExecutor = new NodeProcessExecutor(),
    private readonly gitExecutable = "git",
  ) {}

  async resolveCleanRepository(workspacePath: string | undefined): Promise<CleanRepository> {
    if (!workspacePath) throw new Error("Abrí una carpeta de proyecto Git antes de ejecutar subtareas paralelas.");

    const rootResult = await this.processExecutor.run(this.gitExecutable, ["rev-parse", "--show-toplevel"], {
      cwd: workspacePath,
    });
    const root = rootResult.stdout.trim();
    if (rootResult.exitCode !== 0 || !root || !isAbsolute(root)) {
      throw new Error("Las subtareas paralelas requieren un repositorio Git abierto en VS Code.");
    }

    const status = await this.processExecutor.run(
      this.gitExecutable,
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: root },
    );
    if (status.exitCode !== 0) throw new Error("No se pudo comprobar el estado limpio del repositorio.");
    if (status.stdout.trim()) {
      throw new Error("Guardá o descartá los cambios del repositorio antes de crear worktrees paralelos.");
    }

    const headResult = await this.processExecutor.run(this.gitExecutable, ["rev-parse", "HEAD"], { cwd: root });
    const head = headResult.stdout.trim();
    if (headResult.exitCode !== 0 || !/^[a-f0-9]{40,64}$/i.test(head)) {
      throw new Error("No se pudo fijar el commit base común de los worktrees.");
    }

    return { root: resolve(root), head };
  }

  async createWorktree(
    repositoryRoot: string,
    storageRoot: string,
    runId: string,
    taskId: string,
    baseCommit: string,
  ): Promise<string> {
    if (!/^[a-f0-9]{40,64}$/i.test(baseCommit)) throw new Error("El commit base del worktree no es válido.");
    const worktreePath = resolve(storageRoot, "worktrees", runId, taskId);
    await mkdir(dirname(worktreePath), { recursive: true });
    const result = await this.processExecutor.run(
      this.gitExecutable,
      ["worktree", "add", "--detach", worktreePath, baseCommit],
      { cwd: repositoryRoot },
    );
    if (result.exitCode !== 0) throw new Error("No se pudo crear un worktree aislado para una subtarea.");
    return worktreePath;
  }

  async removeWorktree(repositoryRoot: string, storageRoot: string, worktreePath: string): Promise<void> {
    const allowedRoot = resolve(storageRoot, "worktrees") + sep;
    const resolvedPath = resolve(worktreePath);
    if (!resolvedPath.startsWith(allowedRoot) || relative(repositoryRoot, resolvedPath) === "") {
      throw new Error("El worktree está fuera del espacio administrado por ChePrompt.");
    }
    const result = await this.processExecutor.run(
      this.gitExecutable,
      ["worktree", "remove", resolvedPath],
      { cwd: repositoryRoot },
    );
    if (result.exitCode !== 0) {
      throw new Error("No se pudo quitar el worktree; puede contener cambios sin guardar.");
    }
  }
}
