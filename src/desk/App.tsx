import { useState } from 'react'
import { benchShell } from './bench.ts'
import { Terminal } from './terminal/Terminal.tsx'
import { TerminalModel } from './terminal/model.ts'

// For now the app is only the terminal on a test bench. The desk (logbook,
// printout tray, binder) arrives in build step 6.
export function App() {
  const [model] = useState(() => {
    const terminal = new TerminalModel(benchShell())
    terminal.print('4.2 BSD UNIX (bench)\n\nType "help" to list the commands.\n')
    return terminal
  })

  return (
    <main className="desk">
      <h1>Line Noise</h1>
      <div className="desk-terminal">
        <Terminal model={model} />
      </div>
    </main>
  )
}
