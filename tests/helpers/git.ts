import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

async function git(cwd: string, ...args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(stderr.trim() || `git ${args.join(" ")} failed`)
  return stdout.trim()
}

export interface GitWorktreeFixture {
  readonly root: string
  readonly child: string
  readonly linked: string
  cleanup(): Promise<void>
}

export async function createGitWorktreeFixture(): Promise<GitWorktreeFixture> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-memory-git-"))
  const root = join(temporaryRoot, "repository")
  const child = join(root, "src", "nested")
  const linked = join(temporaryRoot, "linked")
  await mkdir(child, { recursive: true })
  await git(root, "init", "--initial-branch=main")
  await git(root, "config", "user.name", "OpenCode Memory Tests")
  await git(root, "config", "user.email", "tests@example.invalid")
  await Bun.write(join(root, "README.md"), "fixture\n")
  await git(root, "add", "README.md")
  await git(root, "commit", "-m", "test: initialize fixture")
  await git(root, "worktree", "add", linked, "-b", "linked")

  return {
    root,
    child,
    linked,
    async cleanup() {
      await git(root, "worktree", "remove", "--force", linked).catch(() => {})
      await rm(temporaryRoot, { recursive: true, force: true })
    },
  }
}

export async function createGitRepository(parent: string, name: string): Promise<string> {
  const root = join(parent, name)
  await mkdir(root, { recursive: true })
  await git(root, "init", "--initial-branch=main")
  return root
}
