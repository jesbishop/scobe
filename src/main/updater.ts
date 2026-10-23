import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/** Checks GitHub Releases for a newer build; installs it the next time Vanta quits. */
export function startAutoUpdates(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (error) => {
    console.warn('[vanta-update]', error instanceof Error ? error.message : error)
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[vanta-update] ${info.version} downloaded; installs on quit`)
  })
  const check = () => {
    autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
      console.warn('[vanta-update] check failed', error instanceof Error ? error.message : error)
    })
  }
  check()
  setInterval(check, CHECK_INTERVAL_MS).unref()
}
