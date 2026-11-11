import { expect, test, type Page } from '@playwright/test'
import { fill, finishLevel1, finishLevel2, guidance, heard, input, output, panel, type } from './play.ts'

// Level 3, Borrowed Authority, played in the real game from briefing to
// debrief with the keyboard alone: the whiteboard puzzle first, then the
// printout and the terminal.

const board = (page: Page) => page.getByRole('region', { name: 'The building at night' })
const happened = (page: Page) => page.getByRole('log', { name: 'What has happened' })

/**
 * A hoop has begun: the board says which, and the desk has put the keyboard on
 * its first move. Nothing may be pressed before that, or it lands elsewhere.
 */
async function hoop(page: Page, title: string): Promise<void> {
  await expect(board(page)).toContainText(title)
  await expect(board(page).getByRole('button').first()).toBeFocused()
}

/** Make a move on the board: put the keyboard on its button and press Enter. */
async function move(page: Page, name: string | RegExp): Promise<void> {
  await board(page).getByRole('button', { name, exact: true }).focus()
  await page.keyboard.press('Enter')
}

test('Level 3 can be played from briefing to debrief with the keyboard alone', async ({ page }) => {
  await page.goto('/')
  await finishLevel1(page)
  await finishLevel2(page)

  // The briefing.
  await expect(page.getByText('Level 3 of 3')).toBeVisible()
  await expect(page.getByText('An ordinary account cannot turn itself into root.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin' })).toBeFocused()
  await page.keyboard.press('Enter')
  await heard(page, 'You play him.')

  // Hoop 1. The whiteboard stands where the terminal was, with the keyboard on its first move.
  await hoop(page, 'Hoop 1 of 5: Doors')
  await expect(input(page)).toBeHidden()
  await expect(guidance(page)).toContainText('Try its door.')
  await expect(board(page).getByRole('button', { name: 'Office' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(happened(page)).toContainText('on the Office door. Green light. You walk in.')
  await move(page, 'Control Room')
  await expect(happened(page)).toContainText('on the Control Room door. Red light. The door stays shut.')
  await expect(board(page)).toContainText('cleared')
  await heard(page, 'That is all a file permission is')

  // Hoop 2: the courier.
  await hoop(page, 'Hoop 2 of 5: The courier')
  await expect(board(page)).toContainText('MASTER, on loan')
  await move(page, '“Hello from the Lobby.”')
  await expect(board(page)).toContainText('Holding a card: “Hello from the Lobby.”')
  await move(page, 'duty board')
  await expect(happened(page)).toContainText('The reader on the Control Room door sees MASTER. Green light. Dot walks in.')
  await heard(page, 'Her authority is borrowed')

  // Hoop 3: the night round, with a hint on the way.
  await hoop(page, 'Hoop 3 of 5: The night round')
  await guidance(page).getByRole('button', { name: 'Give me a hint' }).focus()
  await page.keyboard.press('Enter')
  await expect(guidance(page)).toContainText('Which spot does he read?')
  await move(page, 'Wait for the next round')
  await expect(happened(page)).toContainText('02:05. Walt makes his round')
  await expect(board(page)).toContainText('Clock 02:05')
  await move(page, '“Give a MASTER badge to whoever is waiting in the Lobby.”')

  // Progress survives a reload in the middle of a hoop.
  await page.reload()
  await hoop(page, 'Hoop 3 of 5: The night round')
  await expect(board(page)).toContainText('Holding a card: “Give a MASTER badge')
  await expect(board(page)).toContainText('Clock 02:05')

  // Handing the card over removes the button that was pressed. The keyboard stays on the board.
  await move(page, 'round hook')
  await expect(happened(page)).toContainText('Dot takes “Check the boilers.” off the round hook')
  await expect(board(page).locator('button:focus')).toHaveCount(1)
  await move(page, 'Wait for the next round')
  await expect(happened(page)).toContainText('He hands you a MASTER badge.')
  await heard(page, 'Three things had to be true at once')

  // Hoop 4: put it back. The new badge opens the door this time.
  await hoop(page, 'Hoop 4 of 5: As you found it')
  await expect(board(page)).toContainText('(put there: 02:00)')
  await move(page, 'Control Room')
  await expect(happened(page)).toContainText('your MASTER badge to the reader on the Control Room door. Green light.')
  await move(page, '“Check the boilers.”')
  await move(page, 'round hook')
  await expect(board(page)).toContainText('(put there: 02:05)')
  await heard(page, 'He cannot put the time back')

  // Hoop 5: the other chair. A change that does nothing, then one that works.
  await hoop(page, 'Hoop 5 of 5: Close the hole')
  await move(page, /heavier lock/)
  await expect(happened(page)).toContainText('RESULT: the trick still works.')
  await expect(board(page)).toContainText('Tried: the trick still worked.')
  await move(page, /Take Dot's loaned badge away/)
  await expect(happened(page)).toContainText('The reader on the Control Room door sees STAFF. Red light.')
  await expect(happened(page)).toContainText('RESULT: the trick fails. The hole is closed.')
  await expect(board(page)).toContainText('no badge of their own')
  await heard(page, 'people call that least privilege')

  // The printout arrives, and the terminal comes back for the real names.
  await expect(page.getByRole('tab', { name: /Printout tray/ })).toContainText('new')
  await heard(page, 'It is in your printout tray')
  await expect(board(page)).toBeHidden()
  await type(page, 'ls -l /usr/local/bin/mvmail')
  await expect(output(page)).toContainText('-rws--x--x  1 root     wheel         44 Mar  4  1985 /usr/local/bin/mvmail')
  await page.keyboard.press('Alt+Digit3')
  await expect(page.getByRole('article', { name: 'Line monitor, ttyn1, 3 September' })).toContainText(
    'granite$ mvmail /tmp/note /usr/lib/atrun',
  )
  await page.keyboard.press('Alt+Digit1')
  await type(page, 'ls -l /usr/lib/atrun')
  await expect(output(page)).toContainText('Sep  3 02:27 /usr/lib/atrun')

  // The logbook: who is who, the badge, and the three conditions.
  await expect(page.getByRole('tab', { name: 'Logbook' })).toHaveAttribute('aria-selected', 'true')
  await fill(page, 'pieces', ['mvmail', 'atrun'])
  await fill(page, 'bit', ['s', 'root'])
  await expect(guidance(page)).toContainText('the three things that had to be true together')
  await expect(page.locator('#entry-conditions input').first()).toBeFocused()
  for (const option of [/runs with root's authority, whoever starts it/, /wherever it is told/, /knew root's password/]) {
    await page.getByRole('checkbox', { name: option }).focus()
    await page.keyboard.press('Space')
  }
  await page.locator('#entry-conditions').getByRole('button', { name: 'Check' }).focus()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toContainText('Nobody told him a password')
  await page.getByRole('checkbox', { name: /knew root's password/ }).focus()
  await page.keyboard.press('Space')
  await page.getByRole('checkbox', { name: /runs the job file every few minutes/ }).focus()
  await page.keyboard.press('Space')
  await page.locator('#entry-conditions').getByRole('button', { name: 'Check' }).focus()
  await page.keyboard.press('Enter')

  // The proof is on paper: start the pin, go to the tray, arrow down to the line.
  await expect(page.getByRole('button', { name: 'Pin a line' })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Alt+Digit3')
  const wanted = page.getByRole('button', { name: /^Pin as evidence: 02:19 granite\$ mvmail/ })
  for (let i = 0; i < 40 && !(await wanted.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('ArrowDown')
  }
  await expect(wanted).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#entry-proof')).toContainText('Logged')

  // The fix, in the player's own words.
  await expect(page.locator('#entry-fix textarea')).toBeFocused()
  await page.keyboard.type('Delete the hollis account.')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(panel(page)).toContainText('In the building it was Dot and her badge.')
  await page.locator('#entry-fix textarea').fill('Take the setuid bit off mvmail, so it stops running as root.')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  // Marge's decision, the card, and the end of the levels so far.
  await heard(page, 'So the hole stays open on granite')
  await expect(page.getByRole('heading', { name: 'Borrowed authority', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finish' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'That is every level so far' })).toBeVisible()

  // All three cards are in the binder.
  await page.getByRole('button', { name: 'Back to the desk' }).click()
  await page.getByRole('button', { name: 'Begin' }).click()
  await page.getByRole('tab', { name: 'Binder' }).click()
  await page.getByRole('button', { name: 'Cards' }).click()
  await expect(panel(page)).toContainText('Logs are evidence')
  await expect(panel(page)).toContainText('Dormant accounts and drifting clocks')
  await expect(panel(page)).toContainText('Borrowed authority')
})
