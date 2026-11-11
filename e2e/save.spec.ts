import { expect, test } from '@playwright/test'
import { finishLevel1, guidance, input, investigateLevel1, output, panel } from './play.ts'

// Progress and the logbook survive a page reload. Saves live in the browser's
// local storage and nowhere else.

test('a level in progress comes back exactly where it was left', async ({ page }) => {
  await page.goto('/')
  await investigateLevel1(page)

  // One entry right, the next one wrong, then the page is closed.
  await page.locator('#entry-account input').fill('pike')
  await page.locator('#entry-account input').press('Enter')
  await page.locator('#entry-time').getByRole('textbox', { name: 'Blank 1' }).fill('3')
  await page.locator('#entry-time').getByRole('textbox', { name: 'Blank 2' }).fill('1380')
  await page.locator('#entry-time').getByRole('textbox', { name: 'Blank 3' }).fill('1.15')
  await page.locator('#entry-time').getByRole('button', { name: 'Check' }).click()
  await expect(panel(page)).toContainText('Not right yet.')

  await page.reload()

  // No briefing again: straight back to the desk, at the same step.
  await expect(page.getByRole('button', { name: 'Begin' })).toHaveCount(0)
  await expect(guidance(page)).toContainText('Now the amount.')

  // The terminal shows what was on it, and is where it was.
  await expect(output(page)).toContainText('Connected to granite.')
  await expect(output(page)).toContainText('3 pike')
  await expect(output(page)).toContainText('> pike')
  await expect(page.getByText('ops@granite:/usr/local/billing')).toBeVisible()

  // The logbook has the finished entry, and the attempt at the next one.
  await expect(page.locator('#entry-account')).toContainText('pike')
  await expect(page.locator('#entry-account')).toContainText('Logged')
  await expect(page.locator('#entry-time').getByRole('textbox', { name: 'Blank 2' })).toHaveValue('1380')
  await expect(panel(page).getByText('Read both sets of books (done)')).toBeVisible()

  // The files the player made are back too, and the level carries on.
  await input(page).click()
  await input(page).fill('cat /tmp/used')
  await input(page).press('Enter')
  await expect(output(page)).toContainText('tnakata')
  await page.locator('#entry-time').getByRole('textbox', { name: 'Blank 2' }).fill('23')
  await page.locator('#entry-time').getByRole('button', { name: 'Check' }).click()
  await expect(guidance(page)).toContainText('When did it start?')
})

test('finished levels and their cards are kept', async ({ page }) => {
  await page.goto('/')
  await finishLevel1(page)
  await page.reload()

  // Back at the next level's briefing, with the first card in the binder.
  await expect(page.getByRole('heading', { name: 'The Account Nobody Opened' })).toBeVisible()
  await page.getByRole('button', { name: 'Begin' }).click()
  await page.getByRole('tab', { name: 'Binder' }).click()
  await page.getByRole('button', { name: 'Cards' }).click()
  await expect(panel(page)).toContainText('Logs are evidence')
})

test('erasing progress is remembered as well', async ({ page }) => {
  await page.goto('/')
  await finishLevel1(page)
  await page.getByRole('button', { name: 'Begin' }).click()
  await page.getByRole('tab', { name: 'Binder' }).click()
  await page.getByRole('button', { name: 'Desk help' }).click()
  await expect(panel(page)).toContainText('saved in this browser')
  await page.getByRole('button', { name: 'Erase all progress' }).click()
  await page.getByRole('button', { name: 'Yes' }).click()
  await expect(page.getByRole('heading', { name: 'The Discrepancy' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'The Discrepancy' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin' })).toBeFocused()
})

test('a damaged save is ignored and the game starts fresh', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.setItem('line-noise.save', '{"version":1,"completed":"oops"'))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'The Discrepancy' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin' })).toBeFocused()
})

test('the test game keeps a save of its own', async ({ page }) => {
  await page.goto('/')
  await finishLevel1(page)
  await page.goto('/?testgame')
  await expect(page.getByRole('heading', { name: 'First', exact: true })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'The Account Nobody Opened' })).toBeVisible()
})
