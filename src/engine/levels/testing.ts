// A tiny, story-free game for testing the level machinery. Written as YAML
// text, exactly as real content is, so the loader is exercised too.

import type { ContentSource } from './loader.ts'

export const TEST_FILES: Record<string, string> = {
  'game.yaml': `
title: Test Game
start: "1986-09-09 08:15"
tty: ttyp2
hosts: [world/box.yaml]
levels: [levels/L01-first.yaml, levels/L02-second.yaml]
credits: { text: A test., url: "https://example.com/" }
`,

  'world/box.yaml': `
name: box
timezone: PDT
installed: "1985-03-01 12:00"
groups:
  - { name: wheel, gid: 0, members: [root] }
  - { name: staff, gid: 10 }
users:
  - { name: root, uid: 0, group: wheel, home: / }
  - { name: ops, uid: 100, group: staff, gecos: Systems Manager }
dirs:
  - { path: /tmp, mode: "1777" }
files:
  - path: /data/list
    content: |
      alpha
      beta
      alpha
  - path: /usr/local/bin/helper
    mode: "4755"
    content: |
      cp /bin/sh /tmp/rootsh
      chmod 4755 /tmp/rootsh
`,

  'levels/L01-first.yaml': `
id: L01-first
number: 1
title: First
mode: guided
host: box
user: ops
brief: Find the name that appears twice.
tray:
  - { id: memo, title: A memo, kind: note, text: "Check the list.\\n" }
beats:
  - say: { who: guide, text: Welcome. }
  - prompt:
      goal: Go to the data directory.
      run: cd /data
      explain: cd changes directory.
      done: { cwd: /data }
  - prompt: { goal: Read the list., run: cat list, explain: cat prints a file. }
  - deliver: { item: memo }
  - prompt: { goal: Count the names., run: "sort list | uniq -c", explain: Count repeated lines. }
  - log: { entry: finding }
  - advance: { seconds: 300, text: Five minutes pass. }
  - say: { who: guide, text: Done. }
objectives:
  - { id: read-list, text: Read the list, when: { read: /data/list } }
  - id: counted
    text: Count the names
    when: { command_ran: [sort, uniq], output_matches: "2 alpha" }
logbook:
  - id: finding
    fill: "The name {name} appears {count} times."
    blanks:
      name: { accept: [alpha] }
      count: { number: { value: 2 }, hint: Look at the number uniq -c printed. }
  - id: which
    ask: Which two are true?
    choose: 2
    options:
      - { id: a, text: Logs are evidence. }
      - { id: b, text: Logs are never wrong. }
      - { id: c, text: Small anomalies are signals. }
    correct: [a, c]
    hint: One of these is too strong.
debrief: cards/first.yaml
`,

  'levels/L02-second.yaml': `
id: L02-second
number: 2
title: Second
mode: open
host: box
user: ops
setup:
  time: "1986-09-10 09:00"
  clone: { sandbox: box }
  overlays:
    box:
      files:
        - { path: /data/new, content: "added in level two\\n" }
    sandbox:
      files:
        - { path: /etc/motd, content: "This is the sandbox.\\n" }
brief: Fix the helper on the sandbox.
beats:
  - connect: { host: sandbox }
objectives:
  - id: saw-bit
    text: Look at the helper
    when: { host: sandbox, command_ran: ls, touched: /usr/local/bin/helper }
  - { id: became-root, text: Become root, when: { host: sandbox, whoami: root } }
  - id: fixed
    text: Remove the setuid bit
    when: { host: sandbox, mode_lacks: { path: /usr/local/bin/helper, bit: setuid } }
  - id: confirmed
    text: Confirm the helper now fails
    when: { host: sandbox, command_ran: helper, failed: true, after: fixed }
logbook:
  - { id: proof, ask: Pin the line that shows the bit., pin: { matches: "^-rws" }, hint: Use ls -l. }
  - id: fix
    ask: Describe the fix in one sentence.
    write: { mentions: [[setuid, "u-s"], [helper]] }
debrief: cards/second.yaml
`,

  'cards/first.yaml': `
id: first
title: Logs are evidence
concept: A log records what happened. Small gaps between two records are worth chasing.
today: Billing reconciliation and cost-anomaly alerts.
note: A real note.
source: { text: A source, url: "https://example.com/paper" }
domains: [Security Operations]
commands: [cd, cat, sort, uniq]
`,

  'cards/second.yaml': `
id: second
title: Borrowed authority
concept: A setuid program runs as its owner. If it does whatever it is told, so can anyone.
today: SUID audits.
note: Another real note.
source: { text: A source, url: "https://example.com/paper" }
simplified: The real program was compiled, not a script.
`,
}

/** A content source over the test files, optionally with some replaced or added. */
export function testSource(overrides: Record<string, string> = {}): ContentSource {
  const files = { ...TEST_FILES, ...overrides }
  return (path) => {
    const text = files[path]
    if (text === undefined) throw new Error(`no such file: ${path}`)
    return text
  }
}
