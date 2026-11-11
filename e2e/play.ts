import { expect, type Page } from '@playwright/test'

// Shared by the end-to-end run of each level: the parts of the desk, and the
// quickest way through the levels that come before the one under test.

export const input = (page: Page) => page.getByRole('textbox', { name: 'Command line' })
export const output = (page: Page) => page.getByRole('log', { name: 'Terminal output' })
export const guidance = (page: Page) => page.getByRole('region', { name: 'Guidance' })
export const panel = (page: Page) => page.getByRole('tabpanel')

/** Read what is said, then press Continue. Keyboard only. */
export async function heard(page: Page, text: string): Promise<void> {
  await expect(guidance(page)).toContainText(text)
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
  await page.keyboard.press('Enter')
}

/** Check that a command is being suggested, then type it and press Enter. Keyboard only. */
export async function type(page: Page, line: string): Promise<void> {
  await expect(guidance(page).locator('.guidance-command')).toHaveText(line)
  await expect(input(page)).toBeFocused()
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
}

/** Fill the blanks of the logbook entry that has just come forward, then press Enter. Keyboard only. */
export async function fill(page: Page, entry: string, values: string[]): Promise<void> {
  await expect(page.locator(`#entry-${entry}`).getByRole('textbox', { name: 'Blank 1' })).toBeFocused()
  for (const [i, value] of values.entries()) {
    if (i > 0) await page.keyboard.press('Tab')
    await page.keyboard.type(value)
  }
  await page.keyboard.press('Enter')
}

/** Start picking a line for the logbook, arrow up to the one wanted, and pin it. Keyboard only. */
export async function pin(page: Page, line: RegExp): Promise<void> {
  await expect(page.getByRole('button', { name: 'Pin a line' })).toBeFocused()
  await page.keyboard.press('Enter')
  const wanted = page.getByRole('button', { name: line })
  for (let i = 0; i < 60 && !(await wanted.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('ArrowUp')
  }
  await expect(wanted).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(output(page)).toContainText('(pinned as evidence)')
}

/** Enter lines at the terminal as fast as possible, pressing Continue whenever someone speaks. */
async function rush(page: Page, lines: string[]): Promise<void> {
  const next = page.getByRole('button', { name: 'Continue' })
  for (const line of lines) {
    await expect(next.or(guidance(page).locator('.guidance-command'))).toBeVisible()
    while (await next.isVisible()) {
      const before = await guidance(page).innerText()
      await next.click()
      await expect(guidance(page)).not.toHaveText(before)
    }
    await input(page).fill(line)
    await input(page).press('Enter')
  }
}

/** From the first briefing to the point where Level 1 turns to the logbook. */
export async function investigateLevel1(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Begin' }).click()
  await rush(page, [
    'pwd',
    'cd /usr/local/billing',
    'ls -l',
    'cat reconcile.aug',
    'cat ledger',
    'head /usr/adm/usage.log',
    'wc -l /usr/adm/usage.log',
    'cut -f1 /usr/adm/usage.log | head',
    'cut -f1 /usr/adm/usage.log | sort | uniq -c',
    'cut -f1 /usr/adm/usage.log | sort | uniq > /tmp/used',
    'cut -f1 ledger | sort > /tmp/billed',
    'diff /tmp/billed /tmp/used',
    'grep pike /usr/adm/usage.log',
    'grep pike ledger',
  ])
  await expect(page.locator('#entry-account input')).toBeVisible()
}

/** From the first briefing to the briefing of Level 2. */
export async function finishLevel1(page: Page): Promise<void> {
  await investigateLevel1(page)
  await page.locator('#entry-account input').fill('pike')
  await page.locator('#entry-account input').press('Enter')
  for (const [blank, value] of ['3', '23', '1.15'].entries()) {
    await page.locator('#entry-time').getByRole('textbox', { name: `Blank ${blank + 1}` }).fill(value)
  }
  await page.locator('#entry-time').getByRole('button', { name: 'Check' }).click()
  await page.locator('#entry-first').getByRole('textbox', { name: 'Blank 1' }).fill('24')
  await page.locator('#entry-first').getByRole('textbox', { name: 'Blank 2' }).fill('03:05')
  await page.locator('#entry-first').getByRole('button', { name: 'Check' }).click()
  await page.getByRole('button', { name: 'Pin a line' }).click()
  await page.getByRole('button', { name: /^Pin as evidence: pike\s+ttyn1\s+Aug 24/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Next level' }).click()
  await expect(page.getByRole('heading', { name: 'The Account Nobody Opened' })).toBeVisible()
}
