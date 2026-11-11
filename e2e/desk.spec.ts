import { expect, test, type Page } from '@playwright/test'

// The desk itself, against the engine's small story-free test game ("?testgame").
// Real levels have their own end-to-end runs.

const input = (page: Page) => page.getByRole('textbox', { name: 'Command line' })
const output = (page: Page) => page.getByRole('log', { name: 'Terminal output' })
const guidance = (page: Page) => page.getByRole('region', { name: 'Guidance' })
const panel = (page: Page) => page.getByRole('tabpanel')

/** Type a line at the terminal and press Enter, keyboard only. */
async function type(page: Page, line: string): Promise<void> {
  await expect(input(page)).toBeFocused()
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
}

/** From the briefing to the first prompt of the first test level, keyboard only. */
async function begin(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Begin' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(input(page)).toBeFocused()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?testgame')
})

test('a guided level can be played from briefing to debrief with the keyboard alone', async ({ page }) => {
  // Briefing: the Begin button has focus.
  await expect(page.getByRole('heading', { name: 'First' })).toBeVisible()
  await expect(page.getByText('Find the name that appears twice.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin' })).toBeFocused()
  await page.keyboard.press('Enter')

  // Something is said: Continue has focus.
  await expect(guidance(page)).toContainText('Welcome.')
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
  await page.keyboard.press('Enter')

  // A command is prompted and explained: the terminal has focus.
  await expect(guidance(page)).toContainText('Go to the data directory.')
  await expect(guidance(page)).toContainText('cd /data')
  await expect(guidance(page)).toContainText('cd changes directory.')
  await type(page, 'cd /data')
  await expect(page.getByText('ops@box:/data')).toBeVisible()

  await expect(guidance(page)).toContainText('cat list')
  await type(page, 'cat list')
  await expect(output(page)).toContainText('beta')

  // Something landed in the tray on the way.
  await expect(page.getByRole('tab', { name: /Printout tray/ })).toContainText('new')

  await expect(guidance(page)).toContainText('sort list | uniq -c')
  await type(page, 'sort list | uniq -c')
  await expect(output(page)).toContainText('2 alpha')

  // The logbook comes forward with the first blank focused.
  await expect(page.getByRole('tab', { name: 'Logbook' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('textbox', { name: 'Blank 1' })).toBeFocused()
  await page.keyboard.type('beta')
  await page.keyboard.press('Tab')
  await page.keyboard.type('2')
  await page.keyboard.press('Enter')

  // A wrong answer is marked, costs nothing, and can be corrected.
  await expect(panel(page)).toContainText('Not right yet.')
  await expect(page.getByRole('textbox', { name: 'Blank 1' })).toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('textbox', { name: 'Blank 1' }).fill('alpha')
  await page.keyboard.press('Enter')
  await expect(panel(page)).toContainText('Logged')

  // Time passes, then the last line.
  await expect(page.getByRole('button', { name: 'Wait' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(guidance(page)).toContainText('Done.')
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
  await page.keyboard.press('Enter')

  // The script has run out; one logbook entry remains.
  await expect(guidance(page)).toContainText('one entry is still open')
  await expect(page.getByRole('button', { name: 'Go to the logbook' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'Logbook' })).toBeFocused()

  // Both goals are ticked.
  await expect(panel(page).getByText('Read the list (done)')).toBeVisible()
  await expect(panel(page).getByText('Count the names (done)')).toBeVisible()

  // Choose two of three with the keyboard.
  await page.getByRole('checkbox', { name: 'Logs are evidence.' }).focus()
  await page.keyboard.press('Space')
  await expect(page.locator('#entry-which').getByRole('button', { name: 'Check' })).toBeDisabled()
  await page.getByRole('checkbox', { name: 'Small anomalies are signals.' }).focus()
  await page.keyboard.press('Space')
  await page.locator('#entry-which').getByRole('button', { name: 'Check' }).focus()
  await page.keyboard.press('Enter')

  // Debrief: the card, and the way on.
  await expect(page.getByRole('heading', { name: 'Logs are evidence' })).toBeVisible()
  await expect(page.getByText('This card is now in your binder.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'A source' })).toHaveAttribute('href', 'https://example.com/paper')
  await expect(page.getByRole('button', { name: 'Next level' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Second' })).toBeVisible()
})

test('a prompt is not satisfied by the wrong command, and nudges after two misses', async ({ page }) => {
  await begin(page)
  await type(page, 'pwd')
  await type(page, 'cd /nowhere')
  await expect(guidance(page)).toContainText('cd /data')
  await expect(guidance(page)).toContainText('Not there yet.')
  await type(page, 'cd /data')
  await expect(guidance(page)).toContainText('cat list')
  await expect(guidance(page)).not.toContainText('Not there yet.')
})

test('the tray shows what was delivered', async ({ page }) => {
  await begin(page)
  await type(page, 'cd /data')

  await page.getByRole('tab', { name: /Printout tray/ }).click()
  await expect(panel(page)).toContainText('The tray is empty.')

  await input(page).click()
  await type(page, 'cat list')
  await page.getByRole('tab', { name: /Printout tray/ }).click()
  await expect(page.getByRole('article', { name: 'A memo' })).toContainText('Check the list.')
  await expect(page.getByRole('tab', { name: /Printout tray/ })).not.toContainText('new')
})

test('the binder keeps the briefing, the steps so far, help and cards', async ({ page }) => {
  await begin(page)
  await type(page, 'cd /data')

  await page.getByRole('tab', { name: 'Binder' }).click()
  await expect(panel(page)).toContainText('Find the name that appears twice.')
  await expect(panel(page)).toContainText('Welcome.')
  await expect(panel(page)).toContainText('cd changes directory.')

  await page.getByRole('button', { name: 'Cards' }).click()
  await expect(panel(page)).toContainText('No cards yet.')

  await page.getByRole('button', { name: 'Desk help' }).click()
  await expect(panel(page)).toContainText('Tab finishes a command or file name')
  await expect(panel(page)).toContainText('Level 2: not reached yet')
})

test('keyboard shortcuts move between the parts of the desk', async ({ page }) => {
  await begin(page)

  // Escape leaves the terminal for the tabs; arrows move between tabs.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tab', { name: 'Logbook' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: /Printout tray/ })).toBeFocused()
  await expect(page.getByRole('tab', { name: /Printout tray/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Binder' })).toBeFocused()

  // Alt-digit jumps straight to a part.
  await page.keyboard.press('Alt+Digit1')
  await expect(input(page)).toBeFocused()
  await page.keyboard.press('Alt+Digit2')
  await expect(page.getByRole('tab', { name: 'Logbook' })).toBeFocused()
  await page.keyboard.press('Alt+Digit4')
  await expect(page.getByRole('tab', { name: 'Binder' })).toBeFocused()
})

/** Complete the first test level quickly, to reach the second. */
async function finishLevelOne(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Begin' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  for (const line of ['cd /data', 'cat list', 'sort list | uniq -c']) {
    await input(page).fill(line)
    await input(page).press('Enter')
  }
  await page.getByRole('textbox', { name: 'Blank 1' }).fill('alpha')
  await page.getByRole('textbox', { name: 'Blank 2' }).fill('2')
  await page.locator('#entry-finding').getByRole('button', { name: 'Check' }).click()
  await page.getByRole('button', { name: 'Wait' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('checkbox', { name: 'Logs are evidence.' }).check()
  await page.getByRole('checkbox', { name: 'Small anomalies are signals.' }).check()
  await page.locator('#entry-which').getByRole('button', { name: 'Check' }).click()
  await page.getByRole('button', { name: 'Next level' }).click()
}

test('an open level: a second host, pinned evidence, a written answer, and the end', async ({ page }) => {
  await finishLevelOne(page)
  await page.getByRole('button', { name: 'Begin' }).click()

  // The terminal is on the sandbox now.
  await expect(output(page)).toContainText('Connected to sandbox.')
  await input(page).click()
  await type(page, 'ls -l /usr/local/bin/helper')
  await type(page, 'helper')
  await type(page, '/tmp/rootsh')
  await expect(page.getByText('root@sandbox:/home/ops')).toBeVisible()
  await type(page, 'chmod u-s /usr/local/bin/helper')
  await type(page, 'exit')
  await type(page, 'helper')
  await expect(output(page)).toContainText('Permission denied')

  // Pin with the mouse: the wrong line first.
  await page.getByRole('button', { name: 'Pin a line' }).click()
  await expect(page.getByText('Choose the line to pin as evidence.')).toBeVisible()
  await page.getByRole('button', { name: /^Pin as evidence: cp: / }).click()
  await expect(panel(page)).toContainText('Not right yet. Use ls -l.')

  // Then with the keyboard: arrow up to the listing and press Enter.
  await expect(page.getByRole('button', { name: 'Pin a different line' })).toBeFocused()
  await page.keyboard.press('Enter')
  const listing = page.getByRole('button', { name: /^Pin as evidence: -rwsr-xr-x/ })
  for (let i = 0; i < 20 && !(await listing.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('ArrowUp')
  }
  await expect(listing).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toContainText('Logged')
  // The pinned line is marked in the terminal, in words as well as colour.
  await expect(output(page)).toContainText('(pinned as evidence)')

  // A written answer is checked for the ideas it mentions, not its exact words.
  await page.getByRole('textbox', { name: 'Describe the fix in one sentence.' }).fill('I removed it.')
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(panel(page)).toContainText('Not right yet.')
  await page
    .getByRole('textbox', { name: 'Describe the fix in one sentence.' })
    .fill('I took the setuid bit off the helper with chmod u-s.')
  await page.getByRole('button', { name: 'Check' }).click()

  await expect(page.getByRole('heading', { name: 'Borrowed authority' })).toBeVisible()
  await expect(page.getByText('The real program was compiled, not a script.')).toBeVisible()
  await page.getByRole('button', { name: 'Finish' }).click()

  await expect(page.getByRole('heading', { name: 'That is every level so far' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Read the public paper.' })).toBeVisible()
})

test('a level can be restarted from the binder, after asking once', async ({ page }) => {
  await begin(page)
  await type(page, 'cd /data')
  await page.getByRole('tab', { name: 'Binder' }).click()
  await page.getByRole('button', { name: 'Desk help' }).click()
  await page.getByRole('button', { name: 'Level 1: First' }).click()
  await expect(panel(page)).toContainText('Start Level 1 from its beginning?')
  await page.getByRole('button', { name: 'No' }).click()
  await expect(guidance(page)).toContainText('cat list')
  await page.getByRole('button', { name: 'Level 1: First' }).click()
  await page.getByRole('button', { name: 'Yes' }).click()
  await expect(page.getByRole('button', { name: 'Begin' })).toBeFocused()
})
