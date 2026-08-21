import { realpath } from "node:fs/promises"
import { basename, dirname, normalize, resolve } from "node:path"
import type { ProjectScope } from "../domain/types"

export async function resolveProject(input: { directory: string; worktree: string }): Promise<ProjectScope> {
  const commonDirectory = await readGitCommonDirectory(input.directory)
  const root = commonDirectory ? await canonicalRepositoryRoot(commonDirectory) : await realpath(input.directory)
  const kind = commonDirectory ? "git" : "path"
  const identity = `${kind}:${normalizeIdentityPath(root)}`

  return {
    projectId: new Bun.CryptoHasher("sha256").update(identity).digest("hex").slice(0, 32),
    root,
    identity,
    kind,
  }
}

async function readGitCommonDirectory(directory: string): Promise<string | undefined> {
  const process = Bun.spawn(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: directory,
    stderr: "ignore",
    stdout: "pipe",
  })
  const [exitCode, stdout] = await Promise.all([process.exited, new Response(process.stdout).text()])
  if (exitCode !== 0) return undefined
  return stdout.trim()
}

async function canonicalRepositoryRoot(commonDirectory: string): Promise<string> {
  const canonicalCommonDirectory = await realpath(commonDirectory)
  if (basename(canonicalCommonDirectory).toLowerCase() === ".git")
    return await realpath(dirname(canonicalCommonDirectory))
  return canonicalCommonDirectory
}

function normalizeIdentityPath(path: string): string {
  const normalized = normalize(resolve(path)).replaceAll("\\", "/").replace(/\/$/, "")
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}
