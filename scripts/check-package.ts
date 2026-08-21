import { mkdir, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

const packageDirectory = ".tmp/package"
const allowedEntries = new Set([
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  "package/dist/index.js",
  "package/dist/index.d.ts",
])

try {
  await rm(packageDirectory, { recursive: true, force: true })
  await mkdir(packageDirectory, { recursive: true })

  const pack = Bun.spawn(["bun", "pm", "pack", "--destination", packageDirectory], {
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await pack.exited) !== 0) throw new Error("Package creation failed")

  const tarballs = (await readdir(packageDirectory)).filter((entry) => entry.endsWith(".tgz"))
  if (tarballs.length !== 1) throw new Error(`Expected one package tarball, found ${tarballs.length}`)

  const listing = Bun.spawn(["tar", "-tf", join(packageDirectory, tarballs[0] as string)], {
    stdout: "pipe",
    stderr: "inherit",
  })
  const entries = (await new Response(listing.stdout).text()).split(/\r?\n/u).filter(Boolean)
  if ((await listing.exited) !== 0) throw new Error("Package listing failed")

  const missing = [...allowedEntries].filter((entry) => !entries.includes(entry))
  const unexpected = entries.filter((entry) => !allowedEntries.has(entry))
  for (const entry of missing) console.error(`Missing package entry: ${entry}`)
  for (const entry of unexpected) console.error(`Unexpected package entry: ${entry}`)
  if (entries.length !== allowedEntries.size) {
    console.error(`Expected ${allowedEntries.size} package entries, found ${entries.length}`)
  }
  if (missing.length > 0 || unexpected.length > 0 || entries.length !== allowedEntries.size) {
    throw new Error("Package entries do not match the allowlist")
  }
} finally {
  await rm(packageDirectory, { recursive: true, force: true })
}
