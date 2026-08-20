import { readFile } from "node:fs/promises"

const excludedDirectories = new Set([".git", "node_modules", "dist", "coverage", ".tmp"])

function isIncludedMarkdown(path: string): boolean {
  const parts = path.replaceAll("\\", "/").split("/")
  return path.toLowerCase().endsWith(".md") && !parts.some((part) => excludedDirectories.has(part))
}

async function trackedMarkdownFiles(): Promise<string[]> {
  const git = Bun.spawn(["git", "ls-files", "-z", "--", "*.md"], {
    stdout: "pipe",
    stderr: "inherit",
  })
  const output = await new Response(git.stdout).text()
  if ((await git.exited) !== 0) process.exit(1)
  return output.split("\0").filter(isIncludedMarkdown)
}

const requestedFiles = process.argv.slice(2)
const files = requestedFiles.length > 0 ? requestedFiles.filter(isIncludedMarkdown) : await trackedMarkdownFiles()
let failed = false

for (const path of files) {
  const content = await readFile(path, "utf8")
  const lines = content.split("\n")
  const locations = new Set<number>()

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1
    if (line.endsWith("\r") || /[ \t]+$/u.test(line.replace(/\r$/u, ""))) locations.add(lineNumber)
  }

  if (!content.endsWith("\n")) locations.add(Math.max(1, lines.length))
  if (content.endsWith("\n\n")) locations.add(Math.max(1, lines.length - 1))

  for (const lineNumber of locations) console.error(`${path}:${lineNumber}`)
  if (locations.size > 0) failed = true
}

if (failed) process.exit(1)
