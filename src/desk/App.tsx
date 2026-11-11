import { useState } from 'react'
import { contentSource } from '../content/index.ts'
import { loadGame, type ContentSource } from '../engine/levels/loader.ts'
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

/**
 * The game. `?testgame` plays the engine's small story-free test game instead
 * of the real levels: the end-to-end tests of the desk itself run against it.
 */
function Play({ source }: { source: ContentSource }) {
  const [game] = useState(() => new Game(loadGame(source), programs))
  return <Desk game={game} />
}

export function App() {
  const params = new URLSearchParams(window.location.search)
  if (params.has('bench')) return <Bench />
  return <Play source={params.has('testgame') ? testSource() : contentSource} />
}
