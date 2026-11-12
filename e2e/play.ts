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

/** Press Continue on what is being said, and wait for the next thing to take its place. */
async function next(page: Page): Promise<void> {
  const before = await guidance(page).innerText()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(guidance(page)).not.toHaveText(before)
}

/** Make moves on the whiteboard, by the names on their buttons. */
async function moves(page: Page, names: (string | RegExp)[]): Promise<void> {
  for (const name of names) await page.locator('#board').getByRole('button', { name, exact: true }).click()
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

/** From the briefing of Level 2 to the briefing of Level 3. */
export async function finishLevel2(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Begin' }).click()
  await rush(page, [
    'grep pike /etc/passwd',
    'ls /usr/local/billing/requests',
    'ls -l /etc/passwd',
    'last pike',
    'last ttyn1',
    'finger hollis',
    'ls -l /usr/adm/usage.log',
    'grep hollis /usr/adm/usage.log',
    'grep ttyn1 /usr/adm/gateway.log',
  ])
  const entries: [string, string[]][] = [
    ['dormant', ['02:14', 'hollis']],
    ['created', ['02:31']],
    ['first-use', ['24', '03:05']],
    ['gateway', ['02:53', '02:47']],
    ['edit', ['03:02', 'root']],
  ]
  for (const [entry, values] of entries) {
    for (const [blank, value] of values.entries()) {
      await page.locator(`#entry-${entry}`).getByRole('textbox', { name: `Blank ${blank + 1}` }).fill(value)
    }
    await page.locator(`#entry-${entry}`).getByRole('button', { name: 'Check' }).click()
    await expect(page.locator(`#entry-${entry}`)).toContainText('Logged')
  }
  await page.getByRole('checkbox', { name: 'hollis' }).check()
  await page.getByRole('checkbox', { name: 'pike' }).check()
  await page.locator('#entry-suspects').getByRole('button', { name: 'Check' }).click()
  await page.getByRole('button', { name: 'Pin a line' }).click()
  await page.getByRole('button', { name: /^Pin as evidence: -rw-r--r--.*usage\.log/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Next level' }).click()
  await expect(page.getByRole('heading', { name: 'Borrowed Authority' })).toBeVisible()
}

/** From the briefing of Level 3 to the briefing of Level 4. */
export async function finishLevel3(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Begin' }).click()
  await next(page)
  await moves(page, ['Control Room'])
  await next(page)
  await moves(page, ['“Hello from the Lobby.”', 'duty board'])
  await next(page)
  await moves(page, ['“Give a MASTER badge to whoever is waiting in the Lobby.”', 'round hook', 'Wait for the next round'])
  await next(page)
  await moves(page, ['Control Room', '“Check the boilers.”', 'round hook'])
  await next(page)
  await moves(page, [/Take Dot's loaned badge away/])
  await rush(page, ['ls -l /usr/local/bin/mvmail', 'ls -l /usr/lib/atrun'])

  const entries: [string, string[]][] = [
    ['pieces', ['mvmail', 'atrun']],
    ['bit', ['s', 'root']],
  ]
  for (const [entry, values] of entries) {
    for (const [blank, value] of values.entries()) {
      await page.locator(`#entry-${entry}`).getByRole('textbox', { name: `Blank ${blank + 1}` }).fill(value)
    }
    await page.locator(`#entry-${entry}`).getByRole('button', { name: 'Check' }).click()
    await expect(page.locator(`#entry-${entry}`)).toContainText('Logged')
  }
  for (const option of [/runs with root's authority, whoever starts it/, /wherever it is told/, /runs the job file every few minutes/]) {
    await page.getByRole('checkbox', { name: option }).check()
  }
  await page.locator('#entry-conditions').getByRole('button', { name: 'Check' }).click()
  await page.getByRole('button', { name: 'Pin a line' }).click()
  await page.getByRole('tab', { name: /Printout tray/ }).click()
  await page.getByRole('button', { name: /^Pin as evidence: 02:19 granite\$ mvmail/ }).click()
  await expect(page.locator('#entry-proof')).toContainText('Logged')
  await page.locator('#entry-fix textarea').fill('Take the setuid bit off mvmail.')
  await page.locator('#entry-fix').getByRole('button', { name: 'Check' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Next level' }).click()
  await expect(page.getByRole('heading', { name: 'Passwords in the Clear' })).toBeVisible()
}
