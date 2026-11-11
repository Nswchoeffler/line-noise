import { expect, test } from '@playwright/test'
import { fill, finishLevel1, guidance, heard, output, panel, pin, type } from './play.ts'

// Level 2, The Account Nobody Opened, played in the real game from briefing
// to debrief with the keyboard alone.

test('Level 2 can be played from briefing to debrief with the keyboard alone', async ({ page }) => {
  await page.goto('/')
  await finishLevel1(page)

  // The briefing.
  await expect(page.getByText('Level 2 of 3')).toBeVisible()
  await expect(page.getByText('An account does not appear by itself.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin' })).toBeFocused()
  await page.keyboard.press('Enter')
  await heard(page, 'Deleting it tells me nothing')

  // The account, its paperwork, and when the password file changed.
  await type(page, 'grep pike /etc/passwd')
  await expect(output(page)).toContainText('pike:pZ7cVn2.KgY1s:110:10::/home/pike:/bin/sh')
  await type(page, 'ls /usr/local/billing/requests')
  await expect(output(page)).toContainText('tnakata')
  await type(page, 'ls -l /etc/passwd')
  await expect(output(page)).toContainText('Aug 22 02:31 /etc/passwd')

  // The logins.
  await type(page, 'last pike')
  await heard(page, 'Who else comes in on that line?')
  await type(page, 'last ttyn1')
  await expect(output(page)).toContainText('Fri Aug 22 01:50 - 02:40')

  // A note has landed in the tray. Read it with the keyboard, then come back.
  await expect(page.getByRole('tab', { name: /Printout tray/ })).toContainText('new')
  await heard(page, 'I have put a note from his division in your printout tray')
  await page.keyboard.press('Alt+Digit3')
  await expect(page.getByRole('tab', { name: /Printout tray/ })).toBeFocused()
  await expect(page.getByRole('article', { name: 'Note from the Theory Division' })).toContainText(
    'Ed Hollis is overseas on sabbatical.',
  )
  await page.keyboard.press('Alt+Digit1')
  await type(page, 'finger hollis')
  await expect(output(page)).toContainText('Last login Mon Sep  1 02:47 on ttyn1 from shale')
  await heard(page, 'Only one account may write to the password file')

  // The tracks.
  await type(page, 'ls -l /usr/adm/usage.log')
  await expect(output(page)).toContainText('Sep  1 03:02 /usr/adm/usage.log')
  await type(page, 'grep hollis /usr/adm/usage.log')
  await heard(page, 'They tidied up after hollis and forgot about pike.')

  // The gateway, and the second note.
  await heard(page, 'the clock on shale is wrong')
  await page.keyboard.press('Alt+Digit3')
  await expect(page.getByRole('article', { name: 'Note taped to the gateway' })).toContainText(
    'THE CLOCK ON SHALE RUNS 6 MINUTES FAST.',
  )
  await page.keyboard.press('Alt+Digit1')
  await type(page, 'grep ttyn1 /usr/adm/gateway.log')
  await expect(output(page)).toContainText('Sep 01 02:53  IN   granite ttyn1  MeridiaNet 9051 0440 2718')

  // The timeline, one line at a time, on granite's clock.
  await expect(page.getByRole('tab', { name: 'Logbook' })).toHaveAttribute('aria-selected', 'true')
  await fill(page, 'dormant', ['02:20', 'hollis'])
  await expect(panel(page)).toContainText('Use the time on granite, not the gateway')
  await page.locator('#entry-dormant').getByRole('textbox', { name: 'Blank 1' }).fill('02:14')
  await page.keyboard.press('Enter')
  await fill(page, 'created', ['02:31'])
  await fill(page, 'first-use', ['24', '03:05'])
  await expect(guidance(page)).toContainText('take off the six minutes')
  await fill(page, 'gateway', ['02:53', '02:47'])
  await fill(page, 'edit', ['03:02', 'root'])

  // What it means: two of five, chosen with the keyboard.
  await expect(guidance(page)).toContainText('Now say what it means.')
  // The desk moves the keyboard to the new entry. Wait for that before pressing anything.
  await expect(page.locator('#entry-suspects input').first()).toBeFocused()
  await page.getByRole('checkbox', { name: 'pike' }).focus()
  await page.keyboard.press('Space')
  await page.getByRole('checkbox', { name: 'root' }).focus()
  await page.keyboard.press('Space')
  await page.locator('#entry-suspects').getByRole('button', { name: 'Check' }).focus()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toContainText("Having root's authority is not the same as logging in as root.")
  await page.getByRole('checkbox', { name: 'root' }).focus()
  await page.keyboard.press('Space')
  await page.getByRole('checkbox', { name: 'hollis' }).focus()
  await page.keyboard.press('Space')
  await page.locator('#entry-suspects').getByRole('button', { name: 'Check' }).focus()
  await page.keyboard.press('Enter')

  // The proof.
  await pin(page, /^Pin as evidence: -rw-r--r--.*Sep\s+1 03:02 \/usr\/adm\/usage\.log/)

  // Marge's last word, the card, and on to the next level.
  await heard(page, 'I am wiring a printer to that line tonight.')
  await expect(page.getByRole('heading', { name: 'Dormant accounts and drifting clocks' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next level' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Level 3 of 3')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Borrowed Authority' })).toBeVisible()
})
