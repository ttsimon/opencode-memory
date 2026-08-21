import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import type { CanaryManifest, CommandRunner } from "./types"
import { packageFiles } from "./types"

interface PackageJson {
  name: string
  version: string
  packageManager: string
  dependencies: Record<string, string>
}
interface BuildInput {
  repository: string
  output: string
  runner?: CommandRunner
}

export async function buildCanaryPackage(input: BuildInput): Promise<CanaryManifest> {
  const repository = resolve(input.repository)
  const output = resolve(input.output)
  const runner = input.runner ?? runCommand
  if ((await stat(output).catch(() => undefined)) !== undefined)
    throw new Error(`Canary output already exists: ${output}`)
  const status = await required(runner(["git", "status", "--porcelain"], repository), "git status")
  if (status.stdout.trim()) throw new Error("Canary build requires a clean repository")
  const branch = (await required(runner(["git", "branch", "--show-current"], repository), "git branch")).stdout.trim()
  if (branch !== "main") throw new Error(`Canary build requires main, received ${branch || "detached HEAD"}`)
  const commit = (await required(runner(["git", "rev-parse", "HEAD"], repository), "git rev-parse HEAD")).stdout.trim()
  const remote = (
    await required(runner(["git", "rev-parse", "origin/main"], repository), "git rev-parse origin/main")
  ).stdout.trim()
  if (commit !== remote) throw new Error("Canary build requires HEAD to equal origin/main")
  for (const command of [
    ["bun", "install", "--frozen-lockfile"],
    ["bun", "run", "check"],
    ["bun", "run", "test:e2e"],
  ]) {
    await required(runner(command, repository), command.join(" "))
  }
  await mkdir(output)
  await required(runner(["bun", "pm", "pack", "--ignore-scripts", "--destination", output], repository), "bun pm pack")
  const tarballs = (await readdir(output)).filter((file) => file.endsWith(".tgz"))
  if (tarballs.length !== 1) throw new Error(`Expected one tarball, found ${tarballs.length}`)
  const tarball = join(output, tarballs[0] ?? "missing.tgz")
  const listing = await required(runner(["tar", "-tf", tarball], repository), "tar -tf")
  const files = listing.stdout.split(/\r?\n/).filter(Boolean).sort()
  if (JSON.stringify(files) !== JSON.stringify([...packageFiles]))
    throw new Error("Tarball file list does not match allowlist")
  const packageJson = JSON.parse(await readFile(join(repository, "package.json"), "utf8")) as PackageJson
  const opencodeVersion = (
    await required(runner(["bunx", "--bun", "opencode", "--version"], repository), "opencode version")
  ).stdout.trim()
  const manifest = await createCanaryManifest({ repository, tarball, commit, packageJson, files, opencodeVersion })
  const temporary = join(output, `.canary-manifest-${crypto.randomUUID()}.json`)
  await Bun.write(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
  await rename(temporary, join(output, "canary-manifest.json"))
  return manifest
}

export async function createCanaryManifest(input: {
  repository: string
  tarball: string
  commit: string
  packageJson: PackageJson
  files: readonly string[]
  opencodeVersion: string
}): Promise<CanaryManifest> {
  if (!isAbsolute(input.tarball)) throw new Error("Tarball path must be absolute")
  const sha256 = new Bun.CryptoHasher("sha256").update(await readFile(input.tarball)).digest("hex")
  return {
    package: { name: input.packageJson.name, version: input.packageJson.version },
    git: { commit: input.commit },
    runtime: {
      bun: input.packageJson.packageManager.replace(/^bun@/, ""),
      opencode: input.opencodeVersion,
      plugin: input.packageJson.dependencies["@opencode-ai/plugin"] ?? "missing",
      sdk: input.packageJson.dependencies["@opencode-ai/sdk"] ?? "missing",
    },
    tarball: { path: input.tarball, sha256, files: [...input.files] },
    builtAt: new Date().toISOString(),
  }
}

async function required(result: Promise<Awaited<ReturnType<CommandRunner>>>, label: string) {
  const value = await result
  if (value.exitCode !== 0) throw new Error(`${label} failed: ${value.stderr.trim()}`)
  return value
}
async function runCommand(command: readonly string[], cwd: string) {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

if (import.meta.main) {
  const output = process.argv[2]
  if (!output) throw new Error("Usage: bun run scripts/canary/build-package.ts <output-directory>")
  const manifest = await buildCanaryPackage({ repository: process.cwd(), output })
  console.log(
    JSON.stringify({ manifest: join(resolve(output), "canary-manifest.json"), sha256: manifest.tarball.sha256 }),
  )
}
