import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource/google-sans/latin-400.css'
import '@fontsource/google-sans/latin-500.css'
import '@fontsource/google-sans/latin-600.css'
import '@fontsource/google-sans/latin-700.css'
import './styles.css'
import { ensureGoogleFontLoaded } from './googleFonts'

ensureGoogleFontLoaded('Inter', 400, false)
ensureGoogleFontLoaded('Inter', 700, false)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
