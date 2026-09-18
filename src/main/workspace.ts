import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Workspace } from '../shared/types'
import { DEFAULT_PAGE } from '../shared/types'

type LegacyWorkspace = {
  version?: number
  camera?: Workspace['camera']
  browsers?: Array<{
    id: string
    url?: string
    x: number
    y: number
    width: number
    height: number
    activeTabId?: string
    tabs?: Array<{ id: string; url: string }>
  }>
      design?: Workspace['design']
  pages?: Workspace['pages']
  activePageId?: string
}

export async function loadWorkspace(file: string): Promise<Workspace | null> {
  try {
    const raw = await readFile(file, 'utf8')
    const data = JSON.parse(raw) as LegacyWorkspace
    if (!data?.camera || !Array.isArray(data.browsers)) return null
    return {
      version: 2,
      camera: data.camera,
      browsers: data.browsers.map((browser) => {
        const tabs =
          browser.tabs?.length ?
            browser.tabs
          : [{ id: browser.id, url: browser.url || 'https://www.google.com' }]
        return {
          id: browser.id,
          x: browser.x,
          y: browser.y,
          width: browser.width,
          height: browser.height,
          activeTabId: browser.activeTabId || tabs[0].id,
          tabs
        }
      }),
      design: Array.isArray(data.design) ? data.design.filter((node) => node && node.id && node.type) : [],
      pages: data.pages?.length ? data.pages : [{ ...DEFAULT_PAGE }],
      activePageId: data.activePageId || data.pages?.[0]?.id || DEFAULT_PAGE.id
    }
  } catch {
    return null
  }
}

export async function saveWorkspace(file: string, workspace: Workspace): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(workspace, null, 2), 'utf8')
}
