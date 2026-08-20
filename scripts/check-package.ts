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
  if ((await pack.exited) !== 0) process.exit(1)

  const tarballs = (await readdir(packageDirectory)).filter((entry) => entry.endsWith(".tgz"))
  if (tarballs.length !== 1) throw new Error(`Expected one package tarball, found ${tarballs.length}`)

  const listing = Bun.spawn(["tar", "-tf", join(packageDirectory, tarballs[0] as string)], {
    stdout: "pipe",
    stderr: "inherit",
  })
  const entries = (await new Response(listing.stdout).text()).split(/\r?\n/u).filter(Boolean)
  if ((await listing.exited) !== 0) process.exit(1)

  const unexpected = entries.filter((entry) => !allowedEntries.has(entry))
  if (unexpected.length > 0) {
    for (const entry of unexpected) console.error(`Unexpected package entry: ${entry}`)
    process.exit(1)
  }
} finally {
  await rm(packageDirectory, { recursive: true, force: true })
}
