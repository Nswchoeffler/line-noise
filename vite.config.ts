import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative asset paths, so the build works at any URL prefix (GitHub Pages
  // serves the site from /<repo-name>/).
  base: './',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
