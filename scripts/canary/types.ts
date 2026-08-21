export const packageFiles = [
  "package/LICENSE",
  "package/README.md",
  "package/dist/index.d.ts",
  "package/dist/index.js",
  "package/package.json",
] as const
export interface CanaryManifest {
  readonly package: { readonly name: string; readonly version: string }
  readonly git: { readonly commit: string }
  readonly runtime: { readonly bun: string; readonly opencode: string; readonly plugin: string; readonly sdk: string }
  readonly tarball: { readonly path: string; readonly sha256: string; readonly files: readonly string[] }
  readonly builtAt: string
}
export interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}
export type CommandRunner = (command: readonly string[], cwd: string) => Promise<CommandResult>
