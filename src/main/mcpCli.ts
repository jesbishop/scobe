import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import { listToolDefinitions, SCOBE_MCP_INSTRUCTIONS } from './mcpServer'
import type { CanvasToolContext } from './canvasTools'

/**
 * Paper-style agent plugins launch `~/.scobe/bin/scobe` with the bridge script, so the plugin
 * files can be static. Scobe keeps that path pointing at its own runtime on every launch.
 */
export function scobeHome(): string {
  return join(homedir(), '.scobe')
}

export function scobeBinDir(): string {
  return join(scobeHome(), 'bin')
}

/** What agents run. On Windows, `bin` is a junction to the install folder, so this resolves to Scobe.exe. */
export function scobeCommand(): string {
  return join(scobeBinDir(), process.platform === 'win32' ? 'Scobe.exe' : 'scobe')
}

export function scobeBridgePath(): string {
  return join(scobeHome(), 'bridge', 'scobe-mcp.cjs')
}

function cachePath(): string {
  return join(scobeHome(), 'mcp-cache.json')
}

function writeIfChanged(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path) && readFileSync(path, 'utf8') === contents) return
  writeFileSync(path, contents, 'utf8')
}

function sameDir(a: string, b: string): boolean {
  const clean = (p: string) => resolve(p.replace(/^\\\\\?\\/, '')).toLowerCase()
  return clean(a) === clean(b)
}

/** The Electron binary can't be copied without its DLLs, so point `bin` at the install folder instead. */
function installWindowsBin(): void {
  if (!app.isPackaged) return
  const bin = scobeBinDir()
  const target = dirname(process.execPath)
  mkdirSync(scobeHome(), { recursive: true })
  if (existsSync(bin) || isLink(bin)) {
    const stat = lstatSync(bin)
    if (!stat.isSymbolicLink()) {
      console.warn(`[scobe-cli] ${bin} is a real folder; leaving it alone`)
      return
    }
    if (sameDir(readlinkSync(bin), target)) return
    try {
      unlinkSync(bin)
    } catch {
      rmdirSync(bin)
    }
  }
  symlinkSync(target, bin, 'junction')
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function installPosixBin(): void {
  // Inside an AppImage, execPath is a temporary mount; APPIMAGE is the file the user keeps.
  const runtime = process.env.APPIMAGE || process.execPath
  const script = [
    '#!/bin/sh',
    '# Installed by Scobe. Runs Scobe in Node mode so agents can start its MCP bridge.',
    `ELECTRON_RUN_AS_NODE=1 exec "${runtime.replace(/(["\\$`])/g, '\\$1')}" "$@"`,
    ''
  ].join('\n')
  const path = scobeCommand()
  writeIfChanged(path, script)
  chmodSync(path, 0o755)
}

function installBridge(): void {
  const source = join(app.getAppPath(), 'resources', 'mcp', 'scobe-mcp.cjs')
  writeIfChanged(scobeBridgePath(), readFileSync(source, 'utf8'))
}

async function writeToolCache(ctx: CanvasToolContext): Promise<void> {
  const tools = await listToolDefinitions(ctx)
  const doc = { version: app.getVersion(), instructions: SCOBE_MCP_INSTRUCTIONS, tools }
  writeIfChanged(cachePath(), `${JSON.stringify(doc, null, 2)}\n`)
}

export async function installScobeCli(ctx: CanvasToolContext): Promise<void> {
  const steps: Array<[string, () => void | Promise<void>]> = [
    ['bridge', installBridge],
    ['command', process.platform === 'win32' ? installWindowsBin : installPosixBin],
    ['tool cache', () => writeToolCache(ctx)]
  ]
  for (const [label, step] of steps) {
    try {
      await step()
    } catch (error) {
      console.warn(`[scobe-cli] ${label} failed:`, error instanceof Error ? error.message : error)
    }
  }
}
