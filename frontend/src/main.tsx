import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyAccessibility } from './lib/a11y'
import { readCachedAccessibility } from './lib/settings'

// Apply cached accessibility preferences before the first paint so even the login page honours them.
applyAccessibility(readCachedAccessibility())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
