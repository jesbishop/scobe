import type { VantaApi } from './index'

declare global {
  interface Window {
    vanta: VantaApi
  }
}

export {}
