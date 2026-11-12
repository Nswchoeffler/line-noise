# Line Noise

A browser game that teaches security fundamentals by having the player hunt an
intruder from a simulated 1986 Unix terminal. The full specification is
`Build Brief Cuckoo's Egg–Inspired Cybersecurity Game.md` in this folder; this
file holds the parts that govern every change.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run check` | Typecheck, lint and unit tests |
| `npm test` | Unit tests only (Vitest) |
| `npm run e2e` | End-to-end tests (Playwright, builds first). Add `-- --project=chromium` for one browser |
| `npm run build` | Typecheck and build the static site into `dist/` |
| `node tools/gen-world.mjs` | Regenerate granite's August records (usage log, login records, ledger, month-end report) so they stay in step |

The site also answers at `?testgame` (the engine's story-free test game, used
by the desk's end-to-end tests) and `?bench` (a bare terminal).

## Layout

- `src/engine/` is story-agnostic: `vfs`, `shell`, `world`, `board`, `intruder`, `levels`, `save`.
- `src/desk/` is the React interface: terminal, logbook, printout tray, binder.
- `src/content/` is all story data: world files, levels, puzzles, printouts, cards, manual pages.
- `e2e/` holds one Playwright run per level.
- Unit tests sit beside the code as `*.test.ts`.

## Locked decisions

Settled. Do not reopen them during the build.

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Audience | Bob, then the public. No terminal experience assumed. |
| 2 | Seat | Tracker-led. Intruder techniques appear as short hands-on replays inside levels. |
| 3 | Shell | Simulated in the browser. No real virtual machine, no backend. |
| 4 | Era | 1986, period-flavored Unix. Modern equivalents live on debrief cards. |
| 5 | Scope | v0.1 is three levels. The full path to v1.0 is defined in the brief. |
| 6 | Outcomes | Command-line skill, concept understanding, and a Security+ domain mapping. |
| 7 | Teaching | Guided, then scaffolded, then open. The logbook is the progress mechanic. |
| 8 | Presentation | Terminal plus a simple desk. Plain graphics; learning over art. |
| 9 | Fiction | "Inspired by." No real names, no book title. |
| 10 | Stack | No constraints. Defaults are in the brief's Architecture section. |

Decisions made since the brief:

- **Terminal:** a custom terminal built from ordinary page elements, not
  xterm.js. Each output line must be clickable and keyboard-reachable so it can
  be pinned as evidence.
- **Hosting:** GitHub Pages, published by `.github/workflows/ci.yml`.
- **Git:** one local commit per build step. Push only when asked.
- **Level 3 is a puzzle** (approved 11 November 2026; the brief is revised to
  match). The hands-on replay is a board puzzle that mimics the hoops the
  intruder went through, not a shell replay on a sandbox host. The game does
  not simulate the real exploit: the player never types it, `mvmail` only
  prints its usage, and the printout leaves out what his file said. Puzzle
  first, real names after. The aim is that it is fun and that it teaches.
- **Level format:** a level may carry a `puzzle` (a board and its stages),
  played by `puzzle` beats, with the predicate `solved`. Added for Level 3;
  the Level 1 and 2 files did not change.
- **Level 4 is built** (Passwords in the Clear), ahead of the v0.2 list in
  the brief. It is a short board puzzle, then a search of the lab's own files
  from the defender's seat, then the printout. The intruder's search is read
  on paper; the player runs the same search as an audit of `granite`.
- **Scaffolded levels use the prompt beat.** The interface shows the `goal`
  and keeps the rest as a ladder of free hints: `nudge`, then `explain`, then
  `run`. `nudge` is a new, optional field on a prompt; nothing else in the
  level format changed, and guided levels ignore it.
- **The board has notes and codes.** A spot may be `covered` (it must be
  looked into), a card may be `found` (not written by the player) and may
  `tell` a code, and a code is one more badge. A board supplies only the
  lines it can print.
- **Focus moves with the step.** The desk moves keyboard focus in a layout
  effect, in the same instant a step changes, never a frame later. A delay
  let fast input land in the wrong place and made the end-to-end tests flaky.

## Principles

- **Levels are data.** The engine contains no story text, names or
  level-specific branches. Anything under `src/engine/` must work for a
  different story.
- **The rules are real.** The filesystem enforces permissions for every
  command. The Level 3 trick works on the puzzle board, and stops working
  after the fix, because a door opens only for a badge it is set to open for.
  No special-casing, and no right-answer flags in a level file: where a
  puzzle asks for a fix, the trick is replayed and the rules decide.
- **Objectives are predicates** over world state, command history and logbook
  answers. Never match exact command strings.
- **Guidance is a level property:** `guided`, `scaffolded` or `open`. The
  interface reads it; the engine does not care.
- **Deterministic.** Same inputs, same world. The clock only moves when a level
  or command moves it. No `Date.now()` or `Math.random()` in the engine.
- **Nothing leaves the browser.** No network calls from the simulated shell,
  ever.
- **Each shell command is a pure function** of arguments, input and context,
  with its own unit tests.

## Content guardrails

### Inspired by, not adapted from

- No real people, living or dead, as characters. No real lab, company or agency names.
- No book title in the game's name, domain or marketing.
- No quoted or paraphrased passages from the book, and no chapter-by-chapter mirroring of it.
- Invented amounts, hostnames, account names and document names throughout.
- Technique classes and real technology names are fair to use. They are the lesson.
- Credits carry one line: inspired by the 1986 Lawrence Berkeley Laboratory
  intrusion, with a link to the public paper.

### Accuracy

- Check each technique against Stoll's 1988 paper, "Stalking the Wily Hacker",
  before writing the level.
- Debrief cards are the only place real history is named. Every historical
  claim there needs a source.
- "The Cuckoo's Egg Decompiled" is CC BY-NC 4.0: reference it, do not adapt its
  materials.
- Where the simulation simplifies the era, say so on the card.

### Safety and tone

- Everything is simulated. No real hosts, no outbound connections, no working
  exploit code for live systems. Intruder techniques are taught by analogy
  (a puzzle) or by reading, not by having the player carry them out.
- Replays always end with the fix. The player is a defender who needs to
  understand the attack.
- The intruder is a patient, methodical adversary, not a genius and not a cartoon.
- Plain interface. Readable type, color never the only signal, full keyboard control.
- Desktop first. A phone layout is out of scope until after v1.0.

## Do not build yet

- Levels 5 and up, or any engine feature only they need.
- Pager, phone, network map, real-time intruder playback.
- Accounts, backend, analytics, leaderboards.
- Sound, animation beyond basics, a phone layout.
- A real virtual machine or any real network access.

## Stop and ask Bob before

- Adding a backend or any paid service.
- Changing the level file format after Level 1 ships.
- Using any real person, organization or book text.
- Cutting an item from the v0.1 acceptance criteria.
