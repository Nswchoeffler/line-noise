import { useState } from 'react'
import { loadGame } from '../engine/levels/loader.ts'
import { testSource } from '../engine/levels/testing.ts'
import { programs } from '../engine/shell/commands/index.ts'
import { benchShell } from './bench.ts'
import { Desk } from './Desk.tsx'
import { Game } from './game.ts'
import { Terminal } from './terminal/Terminal.tsx'
import { TerminalModel } from './terminal/model.ts'

/** `?bench`: the terminal alone on a bare host, for testing the terminal itself. */
function Bench() {
  const [model] = useState(() => {
    const terminal = new TerminalModel(benchShell())
    terminal.print('Connected to bench.\nType "help" to list the commands.\n')
    return terminal
  })
  return (
    <main className="desk">
      <header className="desk-header">
        <h1>Terminal bench</h1>
      </header>
      <div className="desk-terminal">
        <Terminal model={model} />
      </div>
    </main>
  )
}

/** The game. For now it plays the engine's small test game; real levels arrive in build step 7. */
function Play() {
  const [game] = useState(() => new Game(loadGame(testSource()), programs))
  return <Desk game={game} />
}

export function App() {
  const params = new URLSearchParams(window.location.search)
  return params.has('bench') ? <Bench /> : <Play />
}
