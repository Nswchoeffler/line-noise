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

## Layout

- `src/engine/` is story-agnostic: `vfs`, `shell`, `world`, `intruder`, `levels`, `save`.
- `src/desk/` is the React interface: terminal, logbook, printout tray, binder.
- `src/content/` is all story data: world files, levels, printouts, cards, manual pages.
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

## Principles

- **Levels are data.** The engine contains no story text, names or
  level-specific branches. Anything under `src/engine/` must work for a
  different story.
- **The permission model is real.** The Level 3 exploit works because `mvmail`
  runs as root and writes where it is told. No special-casing.
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
  exploit code for live systems.
- Replays always end with the fix. The player is a defender who needs to
  understand the attack.
- The intruder is a patient, methodical adversary, not a genius and not a cartoon.
- Plain interface. Readable type, color never the only signal, full keyboard control.
- Desktop first. A phone layout is out of scope until after v1.0.

## Do not build yet

- Levels 4 and up, or any engine feature only they need.
- Pager, phone, network map, real-time intruder playback.
- Accounts, backend, analytics, leaderboards.
- Sound, animation beyond basics, a phone layout.
- A real virtual machine or any real network access.

## Stop and ask Bob before

- Adding a backend or any paid service.
- Changing the level file format after Level 1 ships.
- Using any real person, organization or book text.
- Cutting an item from the v0.1 acceptance criteria.
