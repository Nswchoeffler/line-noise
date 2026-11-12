import { expect, test, type Page } from '@playwright/test'
import { fill, finishLevel1, finishLevel2, finishLevel3, guidance, heard, input, output, panel } from './play.ts'

// Level 4, Passwords in the Clear, played in the real game from briefing to
// debrief with the keyboard alone: the whiteboard puzzle first, then the
// search at the terminal, where the commands are no longer handed out and
// have to be worked out or asked for.

const board = (page: Page) => page.getByRole('region', { name: 'The building by day' })
const happened = (page: Page) => page.getByRole('log', { name: 'What has happened' })
const command = (page: Page) => guidance(page).locator('.guidance-command')

/** A hoop has begun: the board says which, and the keyboard is on its first move. */
async function hoop(page: Page, title: string): Promise<void> {
  await expect(board(page)).toContainText(title)
  await expect(board(page).getByRole('button').first()).toBeFocused()
}

/** Make a move on the board: put the keyboard on its button and press Enter. */
async function move(page: Page, name: string | RegExp): Promise<void> {
  await board(page).getByRole('button', { name, exact: true }).focus()
  await page.keyboard.press('Enter')
}

/** A step has begun: its goal is shown, no command is, and the keyboard is on the terminal. */
async function step(page: Page, goal: string): Promise<void> {
  await expect(guidance(page)).toContainText(goal)
  await expect(command(page)).toHaveCount(0)
  await expect(input(page)).toBeFocused()
}

/** Type a line at the terminal and press Enter. */
async function enter(page: Page, line: string): Promise<void> {
  await expect(input(page)).toBeFocused()
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
}

test('Level 4 can be played from briefing to debrief with the keyboard alone', async ({ page }) => {
  test.slow()
  await page.goto('/')
  await finishLevel1(page)
  await finishLevel2(page)
  await finishLevel3(page)

  // The briefing.
  await expect(page.getByText('Level 4 of 4')).toBeVisible()
  await expect(page.getByText('He never became root.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin' })).toBeFocused()
  await page.keyboard.press('Enter')
  await heard(page, 'You play him again')

  // Hoop 1. A board with no clock on it, and things that have to be looked into.
  await hoop(page, 'Hoop 1 of 3: A letter left behind')
  await expect(input(page)).toBeHidden()
  await expect(board(page)).not.toContainText('Clock')
  await move(page, 'Annex')
  await expect(happened(page)).toContainText('You try the Annex door with your STAFF badge. It does not open.')
  await move(page, 'Office')
  await expect(board(page)).toContainText('desk drawer: not looked at yet')
  await move(page, 'desk drawer')
  await expect(happened(page)).toContainText('Never write one down.')
  await expect(board(page)).not.toContainText('desk drawer: not looked at yet')
  await move(page, 'Mail Room')
  await move(page, 'pigeonhole')
  await expect(happened(page)).toContainText('Now you know the Annex code.')
  await expect(board(page)).toContainText('STAFF badge + Annex code')
  await move(page, 'Annex')
  await expect(happened(page)).toContainText('You try the Annex door with your Annex code. It opens, and you walk in.')
  await expect(board(page)).toContainText('cleared')
  await heard(page, 'exactly as safe as the place it is written')

  // Hoop 2: one door gives up the code to the next. The last hint puts the keyboard back on the board.
  await hoop(page, 'Hoop 2 of 3: The next door')
  await guidance(page).getByRole('button', { name: 'Give me a hint' }).focus()
  await page.keyboard.press('Enter')
  await expect(guidance(page)).toContainText('You can go further than your badge now.')
  await page.keyboard.press('Enter')
  await expect(guidance(page)).toContainText('look in the folder by the telex')
  await expect(board(page).getByRole('button').first()).toBeFocused()
  await move(page, 'Annex')
  await move(page, 'folder by the telex')
  await expect(happened(page)).toContainText('Vault keypad, 8802.')
  await move(page, 'Vault')
  await heard(page, 'One door gave you the next.')

  // Hoop 3: the other chair. A change that does nothing, then one that works.
  await hoop(page, 'Hoop 3 of 3: Close the hole')
  await move(page, /Hide the letter better/)
  await expect(happened(page)).toContainText('You look in the in-tray in the Office.')
  await expect(happened(page)).toContainText('RESULT: the trick still works.')
  await expect(board(page)).toContainText('Tried: the trick still worked.')
  await move(page, /Change the Annex code/)
  await expect(happened(page)).toContainText('You try the Annex door with your Annex code. It does not open.')
  await expect(happened(page)).toContainText('RESULT: the trick fails. The hole is closed.')
  await expect(board(page)).toContainText('Door opens for: new Annex code')
  await heard(page, 'shredding a letter does not make anyone forget it')
  await heard(page, 'I am not going to read the commands out')

  // The terminal comes back. This time there is a goal, and no command to copy.
  await expect(board(page)).toBeHidden()
  await step(page, 'Find every file there that mentions the word password')
  await expect(guidance(page)).toContainText('Work out the command')

  // A search that minds capitals runs, and misses a file. The step stays.
  await enter(page, 'grep -l password /home/*/*')
  await expect(output(page)).toContainText('/home/osato/notes')
  await expect(output(page)).not.toContainText('/home/jquill/mbox')
  await expect(guidance(page)).toContainText('Find every file there that mentions the word password')

  // The hint ladder: a nudge, then how, then the command. The keyboard ends up back on the terminal.
  await guidance(page).getByRole('button', { name: 'Give me a hint' }).focus()
  await page.keyboard.press('Enter')
  await expect(guidance(page)).toContainText('A nudge.')
  await expect(guidance(page)).toContainText('man grep lists them')
  await expect(command(page)).toHaveCount(0)
  await expect(guidance(page).getByRole('button', { name: 'Another hint (1 of 3 shown)' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(guidance(page)).toContainText('How to do it.')
  await expect(command(page)).toHaveCount(0)
  await expect(guidance(page).getByRole('button', { name: 'Show me the command (hint 3 of 3)' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(command(page)).toHaveText('grep -i -l password /home/*/*')
  await enter(page, 'grep -i -l password /home/*/*')
  await expect(output(page)).toContainText('grep: /home/tnakata/mbox: Permission denied')
  await expect(output(page)).toContainText('/home/jquill/mbox')

  // What it found is explained, without quoting a command back. Then a step done in the player's own way.
  await step(page, 'Find out what the difference between those two files is')
  await expect(guidance(page)).toContainText('What you just found:')
  await expect(guidance(page)).toContainText('Ignoring capitals mattered.')
  await expect(guidance(page)).not.toContainText('You ran:')
  await enter(page, 'ls -l /home/*/mbox')
  await expect(output(page)).toContainText('-rw-------  1 tnakata  staff')
  await step(page, "Read Jonah Quill's saved mail")

  // Progress survives a reload in the middle of the search, and the hints start again unasked.
  await page.reload()
  await step(page, "Read Jonah Quill's saved mail")
  await expect(guidance(page)).toContainText('It is not closed to root.')
  await enter(page, 'cat /home/jquill/mbox')
  await expect(output(page)).toContainText('Password:  magnet7')

  // The matching line is not the secret: the step waits for the whole file.
  await step(page, 'Read all of it, not only the line that mentions the word.')
  await enter(page, 'grep -i password /home/rvoss/getlog')
  await expect(output(page)).toContainText('so that nobody has to type it')
  await expect(guidance(page)).toContainText('Read all of it')
  await enter(page, 'cat /home/rvoss/getlog')
  await expect(output(page)).toContainText('user cryo coldfinger')
  await step(page, 'Three files are left')
  await enter(page, 'grep -i password /home/*/*')
  await expect(output(page)).toContainText('/home/osato/notes:- flint password is prism44, login OPTICS')

  // The printout arrives: he ran the same search in the night.
  await expect(page.getByRole('tab', { name: /Printout tray/ })).toContainText('new')
  await heard(page, 'Three passwords in five files.')

  // The logbook: the count, which files, and the one that stayed shut.
  await expect(page.getByRole('tab', { name: 'Logbook' })).toHaveAttribute('aria-selected', 'true')
  await fill(page, 'count', ['5', '3'])
  await expect(page.locator('#entry-count')).toContainText('Logged')
  await expect(page.locator('#entry-exposed input').first()).toBeFocused()
  for (const option of [/Jonah Quill's saved mail/, /Ruth Voss's command file/, /the Front Office memo/]) {
    await page.getByRole('checkbox', { name: option }).focus()
    await page.keyboard.press('Space')
  }
  await page.locator('#entry-exposed').getByRole('button', { name: 'Check' }).focus()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toContainText('lets nobody in')
  await page.getByRole('checkbox', { name: /the Front Office memo/ }).focus()
  await page.keyboard.press('Space')
  await page.getByRole('checkbox', { name: /Olive Sato's notes/ }).focus()
  await page.keyboard.press('Space')
  await page.locator('#entry-exposed').getByRole('button', { name: 'Check' }).focus()
  await page.keyboard.press('Enter')
  await fill(page, 'shut', ['tnakata', 'root'])

  // The proof is on paper: start the pin, go to the tray, arrow down to the line.
  await expect(page.getByRole('button', { name: 'Pin a line' })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Alt+Digit3')
  await expect(page.getByRole('article', { name: 'Line monitor, ttyn1, 4 September' })).toContainText(
    'granite$ cat /etc/passwd',
  )
  const wanted = page.getByRole('button', { name: /^Pin as evidence: 01:41 granite\$ grep -i -l password/ })
  for (let i = 0; i < 40 && !(await wanted.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('ArrowDown')
  }
  await expect(wanted).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#entry-proof')).toContainText('Logged')

  // The fix, in the player's own words: half of it first, then both halves.
  await expect(page.locator('#entry-fix textarea')).toBeFocused()
  await page.keyboard.type('Delete the passwords from the files.')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(panel(page)).toContainText('One is about the passwords he has already read.')
  await page.locator('#entry-fix textarea').fill('Change all three passwords, and never keep one in a file again.')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  // Marge's last word, the card, and the end of the levels so far.
  await heard(page, 'Whether scrambled is good enough is tomorrow')
  await expect(page.getByRole('heading', { name: 'Passwords in the clear', exact: true })).toBeVisible()
  await expect(page.getByText('Secret scanners search a team')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finish' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'That is every level so far' })).toBeVisible()

  // All four cards are in the binder.
  await page.getByRole('button', { name: 'Back to the desk' }).click()
  await page.getByRole('button', { name: 'Begin' }).click()
  await page.getByRole('tab', { name: 'Binder' }).click()
  await page.getByRole('button', { name: 'Cards' }).click()
  await expect(panel(page)).toContainText('Logs are evidence')
  await expect(panel(page)).toContainText('Borrowed authority')
  await expect(panel(page)).toContainText('Passwords in the clear')
})
