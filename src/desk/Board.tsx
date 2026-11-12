import { useEffect, useLayoutEffect, useRef } from 'react'
import { clockText } from '../engine/board/board.ts'
import type { Move } from '../engine/board/schema.ts'
import type { PuzzleView } from '../engine/levels/runner.ts'

export interface BoardProps {
  view: PuzzleView
  onMove: (move: Move) => void
}

/** A stable name for a move, so its button keeps its identity from one turn to the next. */
function moveId(move: Move): string {
  if (move.do === 'go') return `go-${move.room}`
  if (move.do === 'read') return `read-${move.spot}`
  if (move.do === 'write') return `write-${move.card}`
  if (move.do === 'place') return `place-${move.spot}`
  if (move.do === 'send') return `send-${move.spot}`
  if (move.do === 'fix') return `fix-${move.change}`
  return move.do
}

type MoveOf<K extends Move['do']> = Extract<Move, { do: K }>

/**
 * A board puzzle, drawn as a whiteboard: the rooms and who is in them, the
 * moves open to the player as buttons, and a running account of what has
 * happened. It takes the terminal's place while a puzzle stage is in play.
 *
 * Every move is an ordinary button, so the whole puzzle can be played with
 * Tab and Enter, and every result is written out in words.
 */
export function Board({ view, onMove }: BoardProps) {
  const { stage, play, moves } = view
  const { board, state } = play
  const { courier, round } = board
  const boardRef = useRef<HTMLElement>(null)
  const logRef = useRef<HTMLOListElement>(null)
  /** Whether the keyboard was on the board when the last move was made. */
  const hadFocus = useRef(false)

  // Keep the newest line in view.
  useLayoutEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [state.log])

  // A move can remove the button that made it. Keep the keyboard on the board.
  useEffect(() => {
    const element = boardRef.current
    if (!hadFocus.current || !element || element.contains(document.activeElement)) return
    element.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  }, [play])

  function make(move: Move): void {
    hadFocus.current = boardRef.current?.contains(document.activeElement) ?? false
    onMove(move)
  }

  const badgeName = (id: string): string => board.badges[id] ?? id
  const cardText = (kind: string): string => board.cards[kind]?.text ?? kind
  const roomName = (id: string): string => board.rooms[id]?.name ?? id
  const spotName = (id: string): string => board.spots[id]?.name ?? id

  const button = (move: Move, label: string, quiet = false) => (
    <button
      key={moveId(move)}
      type="button"
      id={`move-${moveId(move)}`}
      className={quiet ? 'button button-quiet' : 'button'}
      onClick={() => make(move)}
    >
      {label}
    </button>
  )

  const of = <K extends Move['do']>(kind: K): MoveOf<K>[] =>
    moves.filter((m): m is MoveOf<K> => m.do === kind)
  const go = of('go')
  const read = of('read')
  const write = of('write')
  const place = of('place')
  const send = of('send')
  const wait = of('wait')
  const fix = of('fix')
  const reset = of('reset')

  const roundSpot = round ? board.spots[round.reads] : undefined
  const tried = (change: string): { held: boolean } | undefined => play.tried.find((t) => t.change === change)

  return (
    <section className="board" id="board" ref={boardRef} aria-labelledby="board-title">
      <header className="board-header">
        <h2 id="board-title">{view.title}</h2>
        <p>
          {view.step} {view.number} of {view.of}: {stage.title}
          {play.solved && (
            <strong className="board-cleared">
              {' '}
              <span aria-hidden="true">✓</span> cleared
            </strong>
          )}
        </p>
        {/* The clock matters only on a board where something happens on a timer. */}
        {round && <p className="board-clock">Clock {clockText(state.clock)}</p>}
      </header>

      <ul className="board-rooms" aria-label="Rooms">
        {Object.entries(board.rooms).map(([roomId, room]) => {
          const here = state.room === roomId
          const spots = Object.entries(board.spots).filter(([, spot]) => spot.room === roomId)
          return (
            <li key={roomId} className={here ? 'board-room board-room-here' : 'board-room'}>
              <h3>{room.name}</h3>
              <p className="board-door">Door opens for: {room.opens_for.map(badgeName).join(', ')}</p>

              {here && (
                <p className="board-person">
                  <strong>You</strong> <span className="board-badge">{state.badges.map(badgeName).join(' + ')}</span>
                  <br />
                  {state.hand === null ? 'Hands empty.' : <>Holding a card: “{cardText(state.hand)}”</>}
                </p>
              )}

              {courier && courier.room === roomId && (
                <p className="board-person">
                  <strong>{courier.name}</strong>{' '}
                  <span className="board-badge">
                    {courier.badge === null ? 'no badge of their own' : `${badgeName(courier.badge)}, on loan`}
                  </span>
                  <br />
                  {courier.about}
                </p>
              )}

              {round && roundSpot && roundSpot.room === roomId && (
                <p className="board-person">
                  <strong>{round.name}</strong> <span className="board-badge">{badgeName(round.badge)}</span>
                  <br />
                  {round.about} Comes by every {round.every} minutes.
                </p>
              )}

              {spots.map(([spotId, spot]) => {
                const on = state.spots[spotId]
                // What is on a covered spot is not known until the player has looked.
                const unread = spot.covered && !state.seen.includes(spotId)
                return (
                  <p key={spotId} className={unread ? 'board-spot board-spot-covered' : 'board-spot'}>
                    <strong>{spot.name}:</strong>{' '}
                    {unread ? (
                      'not looked at yet'
                    ) : on?.card == null ? (
                      'empty'
                    ) : (
                      <>
                        “{cardText(on.card)}”
                        {on.changed !== null && <span className="board-changed"> (put there: {on.changed})</span>}
                      </>
                    )}
                  </p>
                )
              })}
            </li>
          )
        })}
      </ul>

      <div className={moves.length > 0 ? 'board-bottom' : 'board-bottom board-bottom-solo'}>
        {moves.length > 0 && (
          <div className="board-moves" role="group" aria-label="Your moves">
            {fix.length > 0 && (
              <div className="board-fixes">
                <p className="board-moves-label">Make one change, and the trick is tried again:</p>
                <ul>
                  {fix.map((move) => {
                    const text = stage.fix?.changes[move.change]?.text ?? move.change
                    const before = tried(move.change)
                    return (
                      <li key={move.change}>
                        {button(move, text, true)}
                        {before && !before.held && <span className="board-tried"> Tried: the trick still worked.</span>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {go.length > 0 && (
              <p role="group" aria-label="Go to a room">
                <span className="board-moves-label">Go to:</span>{' '}
                {go.map((move) => button(move, roomName(move.room)))}
              </p>
            )}
            {read.length > 0 && (
              <p role="group" aria-label="Look at something in this room">
                <span className="board-moves-label">Look at the:</span>{' '}
                {read.map((move) => button(move, spotName(move.spot)))}
              </p>
            )}
            {write.length > 0 && (
              <p role="group" aria-label="Write a card">
                <span className="board-moves-label">Write a card:</span>{' '}
                {write.map((move) => button(move, `“${cardText(move.card)}”`, true))}
              </p>
            )}
            {place.length > 0 && (
              <p role="group" aria-label="Pin your card up yourself">
                <span className="board-moves-label">Pin your card on the:</span>{' '}
                {place.map((move) => button(move, spotName(move.spot)))}
              </p>
            )}
            {send.length > 0 && courier && (
              <p role="group" aria-label={`Hand your card to ${courier.name}`}>
                <span className="board-moves-label">Hand your card to {courier.name}, for the:</span>{' '}
                {send.map((move) => button(move, spotName(move.spot)))}
              </p>
            )}
            {(wait.length > 0 || reset.length > 0) && (
              <p>
                {wait.map((move) => button(move, 'Wait for the next round'))}{' '}
                {reset.map((move) => button(move, 'Start this part again', true))}
              </p>
            )}
          </div>
        )}

        <div className="board-happened">
          <h3 className="board-log-title" id="board-log-title">
            What has happened
          </h3>
          <ol className="board-log" ref={logRef} role="log" aria-labelledby="board-log-title" tabIndex={0}>
            {state.log.length === 0 && <li className="board-log-empty">Nothing yet. Make a move.</li>}
            {state.log.map((line, i) => (
              <li key={i} data-line={line.key}>
                {line.text}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
