import { ENGINE_VERSION } from '../engine/version.ts'

// Placeholder shell. The real desk (terminal, logbook, printout tray, binder)
// arrives in build step 6.
export function App() {
  return (
    <main className="desk">
      <h1>Line Noise</h1>
      <p>The desk is not built yet. Engine version {ENGINE_VERSION}.</p>
    </main>
  )
}
