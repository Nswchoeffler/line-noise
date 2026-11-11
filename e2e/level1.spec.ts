import { expect, test, type Page } from '@playwright/test'

// Level 1, The Discrepancy, played in the real game from briefing to debrief
// with the keyboard alone.

const input = (page: Page) => page.getByRole('textbox', { name: 'Command line' })
const output = (page: Page) => page.getByRole('log', { name: 'Terminal output' })
const guidance = (page: Page) => page.getByRole('region', { name: 'Guidance' })
const panel = (page: Page) => page.getByRole('tabpanel')

/** Read what Marge says, then press Continue. */
async function heard(page: Page, text: string): Promise<void> {
  await expect(guidance(page)).toContainText(text)
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
  await page.keyboard.press('Enter')
}

/** Check that a command is being suggested, then type it and press Enter. */
async function type(page: Page, line: string): Promise<void> {
  await expect(guidance(page).locator('.guidance-command')).toHaveText(line)
  await expect(input(page)).toBeFocused()
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
}

test('Level 1 can be played from briefing to debrief with the keyboard alone', async ({ page }) => {
  await page.goto('/')

  // The briefing.
  await expect(page.getByRole('heading', { name: 'Line Noise' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The Discrepancy' })).toBeVisible()
  await expect(page.getByText('off by $1.15')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin' })).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(output(page)).toContainText('Connected to granite.')
  await heard(page, 'You type a command, press Enter, and the computer answers.')

  // Finding your way.
  await type(page, 'pwd')
  await expect(output(page)).toContainText('/home/ops')
  await type(page, 'cd /usr/local/billing')
  await expect(page.getByText('ops@granite:/usr/local/billing')).toBeVisible()
  await type(page, 'ls -l')
  await expect(output(page)).toContainText('reconcile.aug')

  // Two sets of books.
  await type(page, 'cat reconcile.aug')
  await expect(output(page)).toContainText('THE BOOKS DO NOT BALANCE')
  await heard(page, 'Two sets of books')
  await type(page, 'cat ledger')
  await expect(output(page)).toContainText('Cryogenics Lab')
  await type(page, 'head /usr/adm/usage.log')
  await type(page, 'wc -l /usr/adm/usage.log')
  await expect(output(page)).toContainText('181')

  // Counting.
  await type(page, 'cut -f1 /usr/adm/usage.log | head')
  await type(page, 'cut -f1 /usr/adm/usage.log | sort | uniq -c')
  await expect(output(page)).toContainText('3 pike')
  await heard(page, 'Are they the same nine?')

  // Comparing.
  await type(page, 'cut -f1 /usr/adm/usage.log | sort | uniq > /tmp/used')
  await type(page, 'cut -f1 ledger | sort > /tmp/billed')
  await type(page, 'diff /tmp/billed /tmp/used')
  await expect(output(page)).toContainText('> pike')
  await heard(page, 'Time on the computer, and no line in the ledger.')

  // The finding.
  await type(page, 'grep pike /usr/adm/usage.log')
  await type(page, 'grep pike ledger')

  // The logbook comes forward, one entry at a time, with the first blank focused.
  await expect(page.getByRole('tab', { name: 'Logbook' })).toHaveAttribute('aria-selected', 'true')
  await expect(guidance(page)).toContainText('That is a finding.')
  await expect(page.locator('#entry-account').getByRole('textbox', { name: 'Blank 1' })).toBeFocused()
  await page.keyboard.type('pike')
  await page.keyboard.press('Enter')

  // Seconds are not minutes: a wrong answer says where to look, and costs nothing.
  await expect(guidance(page)).toContainText('Now the amount.')
  await expect(page.locator('#entry-time').getByRole('textbox', { name: 'Blank 1' })).toBeFocused()
  await page.keyboard.type('3')
  await page.keyboard.press('Tab')
  await page.keyboard.type('1380')
  await page.keyboard.press('Tab')
  await page.keyboard.type('1.15')
  await page.keyboard.press('Enter')
  await expect(panel(page)).toContainText('Not right yet. Add the last column of the three lines')
  await page.locator('#entry-time').getByRole('textbox', { name: 'Blank 2' }).fill('23')
  await page.keyboard.press('Enter')

  await expect(guidance(page)).toContainText('When did it start?')
  await expect(page.locator('#entry-first').getByRole('textbox', { name: 'Blank 1' })).toBeFocused()
  await page.keyboard.type('24')
  await page.keyboard.press('Tab')
  await page.keyboard.type('03:05')
  await page.keyboard.press('Enter')

  // Pin the evidence: arrow up through the terminal to the first session.
  await expect(guidance(page)).toContainText('attach the proof')
  await expect(page.getByRole('button', { name: 'Pin a line' })).toBeFocused()
  await page.keyboard.press('Enter')
  const firstSession = page.getByRole('button', { name: /^Pin as evidence: pike\s+ttyn1\s+Aug 24/ })
  for (let i = 0; i < 20 && !(await firstSession.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('ArrowUp')
  }
  await expect(firstSession).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(output(page)).toContainText('(pinned as evidence)')

  // Marge has the last word, and it is a question.
  await heard(page, 'I do not know who pike is.')

  // The debrief card.
  await expect(page.getByRole('heading', { name: 'Logs are evidence' })).toBeVisible()
  await expect(page.getByText('This card is now in your binder.')).toBeVisible()
  await expect(page.getByRole('link', { name: /Stalking the Wily Hacker/ })).toHaveAttribute(
    'href',
    'https://www.exploit-db.com/download/44091',
  )
  await expect(page.getByRole('button', { name: 'Finish' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'That is every level so far' })).toBeVisible()
})

test('the binder holds the manual for the commands on granite', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Begin' }).click()
  await page.getByRole('tab', { name: 'Binder' }).click()
  await page.getByRole('button', { name: 'Manual' }).click()
  await page.getByRole('button', { name: /^grep/ }).click()
  await expect(panel(page)).toContainText('grep - print lines that match a pattern')
})
