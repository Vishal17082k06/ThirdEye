import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// The full suite runs many jsdom workers at once; give async queries room on slow machines.
configure({ asyncUtilTimeout: 5000 })
