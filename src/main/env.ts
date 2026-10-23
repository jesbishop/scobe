import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export function loadEnv(): void {
  const files = [
    join(process.cwd(), '.env'),
    join(app.getAppPath(), '.env'),
    join(app.getAppPath(), '..', '.env'),
    join(app.getAppPath(), '..', '..', '.env'),
    join(app.getPath('userData'), '.env')
  ]
  for (const file of files) {
    if (!existsSync(file)) continue
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 1) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      // File values win so a fresh .env overrides a stale empty shell env.
      if (value) process.env[key] = value
    }
  }
}
