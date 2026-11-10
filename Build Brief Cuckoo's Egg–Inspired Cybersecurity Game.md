# Build Brief: Cuckoo's Egg–Inspired Cybersecurity Game

Nov 10, 2026 · @bob

## Summary

Line Noise (working title) is a browser game that teaches security fundamentals by having the player hunt an intruder from a simulated 1986 Unix terminal.

- **Premise:** a new lab sysadmin chases a tiny billing error and finds someone living inside the lab's computers.
- **Source:** inspired by the 1986 Lawrence Berkeley Laboratory intrusion. Every person, organization and detail in the game is invented.
- **Audience:** Bob first, then the public. Assumes zero terminal experience.
- **Seat:** the tracker. Each intruder technique is also replayed hands-on, then fixed.
- **Size:** 13 levels in three acts and an epilogue, shipped across six versions (v0.1 to v1.0).
- **Next build:** v0.1, three guided levels, static site, no backend.

After finishing, a player can:

1. Work a Unix command line: files, permissions, pipes, logs.
2. Explain the core ideas in their own words: least privilege, setuid, hashing, default credentials, monitoring, honeypots, incident response.
3. Connect each idea to its modern equivalent and to the Security+ exam domains.

## Locked decisions

These ten choices are settled; do not reopen them during the build.

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Audience | Bob, then the public. No terminal experience assumed. |
| 2 | Seat | Tracker-led. Intruder techniques appear as short hands-on replays inside levels. |
| 3 | Shell | Simulated in the browser. No real virtual machine, no backend. |
| 4 | Era | 1986, period-flavored Unix. Modern equivalents live on debrief cards. |
| 5 | Scope | v0.1 is three levels. The full path to v1.0 is defined in this brief. |
| 6 | Outcomes | Command-line skill, concept understanding, and a Security+ domain mapping. |
| 7 | Teaching | Guided, then scaffolded, then open. The logbook is the progress mechanic. |
| 8 | Presentation | Terminal plus a simple desk. Plain graphics; learning over art. |
| 9 | Fiction | "Inspired by." No real names, no book title. |
| 10 | Stack | No constraints. Defaults are set in Architecture. |

## Player experience

The player sits at a desk, investigates in a terminal, and clears each level by writing what they found in a logbook.

### The desk

| Object | Purpose | Arrives |
| --- | --- | --- |
| Terminal | Simulated Unix shell. All hands-on work happens here. | v0.1 |
| Logbook | Findings with pinned evidence. Completing it clears the level. | v0.1 |
| Printout tray | Transcripts of the intruder's sessions, shown as line-printer paper. | v0.1 |
| Binder | Manual pages, hints, debrief cards, glossary. | v0.1 |
| Pager | Buzzes when the intruder connects. | v0.3 |
| Phone | Short calls to network operators and investigators. | v0.4 |
| Network map | The hops the player has confirmed so far. | v0.4 |

### Teaching arc

| Mode | Levels | What the player is given | Logbook format |
| --- | --- | --- | --- |
| Guided | 1–3 | Every command is prompted and explained before it is typed. | Fill in the blank |
| Scaffolded | 4–9 | A goal plus a three-step hint ladder: nudge, approach, exact command. | Answer prompts |
| Open | 10–13 | A goal only. Several routes are valid. | Free entries with pinned evidence |

### Rules of the loop

- Every level runs brief, investigate, logbook, debrief card.
- Objectives check world state and logbook answers, never exact command strings.
- Intruder replay: read his transcript, repeat the technique on a sandbox host, then fix it.
- A debrief card holds the concept in two sentences, the modern equivalent, and one real-world note.
- Hints are free. No score. No timers before Level 12.
- Pinning evidence means clicking a terminal or printout line to attach it to a logbook entry.

## Fictional setting

Real technologies keep their real names; every organization, person, hostname, document and amount is invented. All names below are placeholders Bob can swap.

| Element | In the game |
| --- | --- |
| Working title | Line Noise |
| Year | 1986 |
| Lab | Calder Ridge Laboratory, a civilian physics lab in the western US |
| Player | "You", the newest systems manager. Never named or pictured. |
| Mentor | Marge Okafor, senior sysadmin. Her voice carries the guided prompts. |
| Unix hosts | `granite` (main), `basalt` (second), `shale` (network gateway) |
| Other host | `flint`, a non-Unix minicomputer with vendor default accounts |
| The intruder | Nicknamed "the Lodger" by the team. Works through a dormant account, `hollis`. |
| Rogue account | `pike`, created with no paperwork |
| Carrier network | MeridiaNet, a commercial packet-switched network |
| Vulnerable program | `mvmail`, a mail helper from the Scribe editor, installed setuid root |
| Bait | Project LANTERN, a made-up research program |
| Origin | Overseas. City and buyer are invented; no real agencies appear. |
| Trigger | A $1.15 gap between two sets of books |

Kept real because they are the lesson: Unix, setuid, file permissions, password hashing, X.25, RS-232 serial lines, dial-up modems, ARPANET and MILNET.

## Curriculum map

Thirteen levels cover the investigation from first anomaly to cleanup; each teaches one cluster of concepts and names its modern equivalent.

| # | Level | The player… | Concepts | Today |
| --- | --- | --- | --- | --- |
| 1 | The Discrepancy | Reconciles two sets of usage books and finds an account with usage but no billing record | Logs as evidence, anomaly detection, files and pipes | Usage and billing reconciliation, cost-anomaly alerts |
| 2 | The Account Nobody Opened | Works out whose account it is, spots a dormant account in use, corrects for clock drift to build a timeline | Account lifecycle, login records, time sync | Access reviews, orphaned accounts, NTP and UTC in forensics |
| 3 | Borrowed Authority | Reads the intruder's transcript, repeats the root trick in a sandbox, then removes the setuid bit | Permissions, setuid, least privilege, privilege escalation | SUID audits, sudo rules, writable scheduled-job paths, patching |
| 4 | Passwords in the Clear | Sweeps mail and command files the way the intruder did and counts exposed passwords | Secrets in files, credential hygiene | Secrets in repos and config files, secret scanners |
| 5 | The Dictionary | Runs a toy dictionary attack on the lab's own password file to measure exposure | Hashing versus encryption, dictionary attacks, password policy | Salted slow hashes, breached-password lists, MFA |
| 6 | Default Doors | Tallies the intruder's default-login attempts elsewhere and audits the lab's own hosts | Default credentials, enumeration, attack surface | Default device passwords, exposed admin panels, credential stuffing |
| 7 | Close It or Watch It | Chooses a response plan, moves team talk off email, starts an evidence log | Incident response phases, containment versus observation, out-of-band communication | Incident response playbooks, chain of custody |
| 8 | The Printer on the Line | Taps the incoming serial lines to a printer and writes an alarm for stolen account names | Out-of-band monitoring, detection rules, false alarms | Network taps, endpoint detection, SIEM rules on known indicators |
| 9 | Hidden Doors | Hunts for what was left behind: a sleeper account, a password-capturing login, hidden setuid copies | Persistence, trojans, file integrity | Persistence hunting, file integrity monitoring, golden images |
| 10 | Where From? | Builds a login-time histogram, reads command habits, times network echoes | Traffic analysis, attribution from behavior, hypothesis testing | Attacker tactics catalogs, time-zone and latency clues |
| 11 | The Chain | Traces hop by hop through carriers and a contractor's open modem pool, bringing each operator the evidence they need | Pivoting, log correlation across organizations, legal process | Proxy and VPN chains, cross-organization response, subpoenas |
| 12 | Project LANTERN | Designs bait files with tight permissions and an access alarm, then keeps the intruder reading until the trace completes | Deception, honeypots, honeytokens, alert on access | Canary tokens, deception platforms |
| 13 | Picking Up the Pieces | Hardens the lab under a limited budget and files the incident report | Remediation, defense in depth, usability tradeoffs, lessons learned | Post-incident reviews, hardening baselines |

### Security+ mapping

| Security+ domain | Levels |
| --- | --- |
| General Security Concepts | 3, 5, 7, 12 |
| Threats, Vulnerabilities, and Attacks | 3, 4, 5, 6, 9 |
| Security Architecture | 6, 8, 13 |
| Security Operations | 1, 2, 8, 9, 10, 11, 13 |
| Security Program Management and Oversight | 7, 11, 13 |

Domain names follow exam version SY0-801, expected to launch on November 17, 2026; SY0-701 calls the second domain "Threats, Vulnerabilities, and Mitigations" ([source](https://www.infosectrain.com/blog/comptia-security-sy0-801-vs-sy0-701-key-differences-exam-advice)). The mapping is by theme. Check each level against CompTIA's published objectives before v1.0.

Technique mechanics follow the public record of the 1986 case, [Stoll's 1988 paper](https://www.exploit-db.com/download/44091). Its figures make good debrief notes: about 5% of machines tried fell to default logins, and 20% of the lab's own passwords fell to a dictionary.

## Version roadmap

Six versions take the game from a three-level slice to a public launch, and v1.0 is the end of the project.

&#91;embedded content: version roadmap · 6 versions under 3 acts and an epilogue\]

Each version ships the levels under the act above it, and guidance loosens as the acts advance.

| Version | Name | Levels | Engine and desk additions | Done when |
| --- | --- | --- | --- | --- |
| v0.1 | First Slice | 1–3 | Shell, filesystem with permissions, level runner, logbook, printout tray, binder, local save | A first-time terminal user finishes all three levels unaided |
| v0.2 | Know the Intruder | 4–6 | Hint ladder, multiple hosts, toy password cracker, glossary | The player has measured the lab's own exposure three ways |
| v0.3 | Tripwires | 7–9 | Pager, real-time intruder sessions, player-written alarm scripts, file comparison tools | The player's alarm catches a live session without a false alarm |
| v0.4 | Traceback | 10–11 | Phone calls, network map, timing tools, open mode | The player names the origin network from their own evidence |
| v0.5 | The Bait | 12 | Checks on player-made files, alarmed files, one timed finale | The trace completes during a session the player's bait caused |
| v1.0 | Aftermath and Launch | 13 | Incident report export, concept index, accessibility pass, feedback link | Three outside testers finish the full game at the public URL |

- **Start:** the first command of Level 1.
- **End:** v1.0 live with all 13 levels. Nothing below is part of this project.
- **Rule:** every version stays playable from Level 1, with saves carried forward.

### After v1.0 (out of scope)

- Accounts and cloud saves
- A campaign played from the intruder's seat
- A modern-era remix of the same levels
- A real virtual machine mode
- Instructor tools and class codes

## v0.1 spec: First Slice

v0.1 is three guided levels on one simulated host, about an hour of play, running entirely in the browser.

### World

- One host, `granite`, plus a throwaway copy named `sandbox` for the Level 3 replay.
- Users: `root`, `marge`, `ops` (the player), `hollis` (dormant), `pike` (rogue), and six ordinary staff accounts.
- An in-game clock that levels can advance, and a job runner that fires on a timer.

| Path | Holds |
| --- | --- |
| `/usr/adm/usage.log` | System accounting: user, port, start time, seconds used |
| `/usr/local/billing/ledger` | The lab's own billing: account, department, charges |
| `/usr/local/billing/requests/` | One paperwork file per approved account |
| `/etc/passwd` | The account list |
| `/usr/adm/gateway.log` | Connection log copied from the gateway, whose clock runs six minutes fast |
| `/usr/local/bin/mvmail` | The mail helper, owned by root with the setuid bit set |
| `/usr/lib/atrun` | The job runner, executed as root every few minutes |

### Shell

- Commands: `ls` (`-l -a`), `cd`, `pwd`, `cat`, `more`, `head`, `tail`, `grep` (`-i -v -c -n`), `sort` (`-n -r`), `uniq` (`-c`), `wc` (`-l`), `diff`, `who`, `whoami`, `finger`, `last`, `date`, `ps`, `chmod`, `cp`, `mv`, `rm`, `echo`, `man`, `history`, `clear`.
- Operators: pipe `|`, redirect `>` and `>>`, quoting.
- Line editing: history with arrow keys, tab completion, Ctrl-C, Ctrl-L.
- Permissions are enforced. A command fails with the right error when the user lacks access.
- Era-flavored, not emulated. Unknown commands and flags give a short, friendly error.

### Level 1: The Discrepancy (about 15 minutes)

- **Setup:** month-end books are off by $1.15. Marge asks the player to find it.
- **Beats:** move to the billing directory; read the ledger; count usage per user with `sort | uniq -c`; compare the two user lists; find that `pike` has usage and no billing record.
- **Logbook:** which account, how much time, first seen when.
- **Debrief:** logs are evidence and small anomalies are signals. Today: usage and billing reconciliation, cost-anomaly alerts.

### Level 2: The Account Nobody Opened (about 15 minutes)

- **Setup:** nobody approved `pike`.
- **Beats:** find `pike` in `/etc/passwd`; confirm there is no request file; `last pike` shows odd-hour logins from the network port; `last` also shows `hollis`, who a desk note says has been abroad for a year; `ls -l` shows root edited the usage log at 3 a.m.; correct the gateway log by six minutes and line the events up.
- **Logbook:** a five-line timeline in corrected time; which accounts are suspect; the evidence that someone had root.
- **Debrief:** account lifecycle, dormant accounts, clock sync. Today: access reviews, orphaned accounts, NTP and UTC in forensics.

### Level 3: Borrowed Authority (about 25 minutes)

- **Setup:** a printout lands in the tray. It is the intruder's session from last night.
- **Beats:** read the transcript; `ls -l` on `mvmail` shows the `s` bit; `man chmod` explains it; note that `atrun` runs as root on a timer.
- **Replay on `sandbox`:** write a two-line script; use `mvmail` to place it over `atrun`; wait for the timer; `whoami` now says root; put the original back.
- **Fix:** `chmod u-s` on `mvmail`; confirm the replay now fails.
- **Logbook:** pick the three conditions that made it work, then write the fix in one sentence.
- **Debrief:** permissions, setuid, least privilege, privilege escalation. Today: SUID audits, sudo rules, writable scheduled-job paths, patching. History note: the real 1986 intruder abused an editor's setuid mail helper the same way.
- **Cliffhanger:** Marge says to leave the hole open on `granite` for now. That sets up Level 7.

### Acceptance criteria

- [ ] A first-time terminal user finishes Levels 1 to 3 in under 60 minutes with no outside help.
- [ ] Every listed command works alone and in pipes, with unit tests per command.
- [ ] Each objective accepts any valid route, not one exact command.
- [ ] The Level 3 replay succeeds before the fix and fails after it, because of the permission model and not a script flag.
- [ ] Progress and logbook survive a page reload.
- [ ] Each level ends with a debrief card saved to the binder.
- [ ] Fully playable by keyboard on current desktop Chrome, Firefox and Safari.
- [ ] Deployed as a static site at a public URL.

## Architecture and stack

The game is a static single-page app: a story-agnostic engine plus levels written as data.

### Default stack

- TypeScript, React, Vite. Static build, any static host.
- xterm.js for terminal rendering, with a small line-editing layer on top.
- Vitest for unit tests. Playwright for one end-to-end run per level.
- Browser local storage for saves, with a versioned schema.
- No backend, accounts or analytics before v1.0.

Claude Code should check current library docs before installing and may propose swaps, with a reason.

### Modules

| Module | Responsibility |
| --- | --- |
| `vfs` | In-memory filesystem per host: owner, group, mode bits including setuid, modified time. |
| `shell` | Parser for quotes, pipes and redirects. Command registry. Each command is a pure function of arguments, input and context. |
| `world` | Hosts, users, the in-game clock, scheduled jobs, an event bus. |
| `intruder` | Scripted sessions: a timeline of commands applied to the world and rendered as printouts. Real-time playback from v0.3. |
| `levels` | Declarative level files and the runner that loads them, checks objectives and drives prompts. |
| `desk` | The interface: terminal, logbook, printout tray, binder. Pager, phone and map later. |
| `save` | Serialize progress and logbook. Migrate old saves. |

### Principles

- **Levels are data.** The engine contains no story text, names or level-specific branches.
- **The permission model is real.** The Level 3 exploit works because `mvmail` runs as root and writes where it is told. No special-casing.
- **Objectives are predicates** over world state, command history and logbook answers.
- **Guidance is a level property:** `guided`, `scaffolded` or `open`. The interface reads it; the engine does not care.
- **Deterministic.** Same inputs, same world. The clock only moves when a level or command moves it.
- **Nothing leaves the browser.** No network calls from the simulated shell, ever.

### Level file sketch

```yaml
id: L03-borrowed-authority
mode: guided
host: granite
filesystem: overlays/L03.yaml      # files added or changed for this level
printouts: [intruder/L03-session.yaml]
beats:
  - say: { who: marge, text: "Read the printout before you touch anything." }
  - prompt: { run: "ls -l /usr/local/bin/mvmail", explain: "Look at the fourth character." }
objectives:
  - id: saw-setuid
    when: { command_ran: ls, touched: /usr/local/bin/mvmail }
  - id: replayed
    when: { host: sandbox, whoami: root }
  - id: fixed
    when: { host: sandbox, mode_lacks: { path: /usr/local/bin/mvmail, bit: setuid } }
logbook:
  - ask: "Which three conditions made this work?"
    choose: 3
    correct: [runs-as-root, no-destination-check, system-runs-that-path]
hints: []                          # used from scaffolded mode on
debrief: cards/setuid.md
```

The format is a sketch. Claude Code should finalize it while building Level 1, then keep it stable.

## Content guardrails

The game borrows the techniques and the arc of a documented historical case, and nothing else.

### Inspired by, not adapted from

- No real people, living or dead, as characters. No real lab, company or agency names.
- No book title in the game's name, domain or marketing.
- No quoted or paraphrased passages from the book, and no chapter-by-chapter mirroring of it.
- Invented amounts, hostnames, account names and document names throughout.
- Technique classes and real technology names are fair to use. They are the lesson.
- Credits carry one line: inspired by the 1986 Lawrence Berkeley Laboratory intrusion, with a link to the public paper.
- This is not legal advice. Get proper advice before any commercial release.

### Accuracy

- Check each technique against [Stoll's 1988 paper](https://www.exploit-db.com/download/44091) before writing the level.
- Debrief cards are the only place real history is named. Every historical claim there needs a source.
- [The Cuckoo's Egg Decompiled](https://chrissanders.org/training/cuckoosegg/) is a good concept cross-check. It is licensed CC BY-NC 4.0, so reference it but do not adapt its materials into a commercial product.
- Where the simulation simplifies the era, say so on the card.

### Safety and tone

- Everything is simulated. No real hosts, no outbound connections, no working exploit code for live systems.
- Replays always end with the fix. The player is a defender who needs to understand the attack.
- The intruder is a patient, methodical adversary, not a genius and not a cartoon.
- Plain interface. Readable type, color never the only signal, full keyboard control.
- Desktop first. A phone layout is out of scope until after v1.0.

## First Claude Code session

The first session builds the engine far enough to play Level 1 end to end, then adds Levels 2 and 3.

### Build order

1. Scaffold the project, tests and a deploy pipeline. Write a `CLAUDE.md` holding the Locked decisions, Principles and Content guardrails from this brief.
2. Build `vfs` with users and permission checks. Test it hard; everything else stands on it.
3. Build the `shell` parser, pipes, redirects and the v0.1 command list, with tests per command.
4. Wire the terminal to the shell: history, tab completion, Ctrl-C, Ctrl-L.
5. Build the level runner: load a level file, run beats, evaluate objectives.
6. Build the desk: terminal, logbook, printout tray, binder.
7. Author Level 1 and play it start to finish. Fix the level format now, while it is cheap.
8. Author Level 2.
9. Add the clock, the job runner and the `sandbox` host. Author Level 3.
10. Add save and load, debrief cards, and deploy.

### Do not build yet

- Levels 4 and up, or any engine feature only they need.
- Pager, phone, network map, real-time intruder playback.
- Accounts, backend, analytics, leaderboards.
- Sound, animation beyond basics, a phone layout.
- A real virtual machine or any real network access.

### Stop and ask Bob before

- Adding a backend or any paid service.
- Changing the level file format after Level 1 ships.
- Using any real person, organization or book text.
- Cutting an item from the v0.1 acceptance criteria.

### How to start the session

Paste this brief, then ask Claude Code to restate the v0.1 scope in ten lines and propose a file layout before writing code.

## Open items

None of these block v0.1; each has a default the build will use until Bob says otherwise.

- [ ] **Title.** Default: Line Noise. Check that the name and a domain are free before anything public.
- [ ] **Names.** Lab, mentor, hosts and accounts are placeholders. Swap any of them.
- [ ] **Naming the real case on debrief cards.** Default: yes, sourced, cards only.
- [ ] **The espionage angle.** Default: an unnamed overseas buyer, revealed in Act 3. Alternative: leave the motive unknown.
- [ ] **Placeholder numbers.** The $1.15 gap and the share of passwords that crack in Level 5.
- [ ] **First testers.** The v0.1 exit test needs three people with no terminal experience. Who?
- [ ] **Repo and hosting.** Default: public GitHub repo, static host. Open-source license undecided.
- [ ] **Pace.** No dates are set for any version.

## Sources

- [Stalking the Wily Hacker](https://www.exploit-db.com/download/44091), Clifford Stoll, Communications of the ACM, May 1988. The technical record of the case.
- [The Cuckoo's Egg Decompiled](https://chrissanders.org/training/cuckoosegg/), Chris Sanders. Free course mapping the story to modern concepts.
- [Security+ SY0-801 vs SY0-701](https://www.infosectrain.com/blog/comptia-security-sy0-801-vs-sy0-701-key-differences-exam-advice), InfosecTrain, October 2026. Exam domains and transition dates.
