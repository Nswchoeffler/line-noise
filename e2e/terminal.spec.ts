import { expect, test, type Page } from '@playwright/test'

// The terminal on its own, against the story-free bench host.

const input = (page: Page) => page.getByRole('textbox', { name: 'Command line' })
const output = (page: Page) => page.getByRole('log', { name: 'Terminal output' })

async function run(page: Page, line: string): Promise<void> {
  await input(page).fill(line)
  await input(page).press('Enter')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?bench')
  await expect(input(page)).toBeFocused()
})

test('runs a command and shows its output', async ({ page }) => {
  await input(page).pressSequentially('echo hello world')
  await input(page).press('Enter')
  await expect(output(page)).toContainText('bench$ echo hello world')
  await expect(output(page).getByText('hello world', { exact: true })).toBeVisible()
  await expect(input(page)).toHaveValue('')
  await expect(input(page)).toBeFocused()
})

test('runs pipes and redirects', async ({ page }) => {
  await run(page, 'echo saved > out; cat out | wc -l')
  await expect(output(page).getByText('1', { exact: true })).toBeVisible()
})

test('shows errors from the shell', async ({ page }) => {
  await run(page, 'cat /no/such/file')
  await expect(output(page)).toContainText('cat: /no/such/file: No such file or directory')
})

test('recalls history with the arrow keys', async ({ page }) => {
  await run(page, 'echo one')
  await run(page, 'echo two')
  await input(page).press('ArrowUp')
  await expect(input(page)).toHaveValue('echo two')
  await input(page).press('ArrowUp')
  await expect(input(page)).toHaveValue('echo one')
  await input(page).press('ArrowDown')
  await expect(input(page)).toHaveValue('echo two')
  await input(page).press('ArrowDown')
  await expect(input(page)).toHaveValue('')
})

test('completes commands and file names with Tab', async ({ page }) => {
  await input(page).pressSequentially('whoa')
  await input(page).press('Tab')
  await expect(input(page)).toHaveValue('whoami ')
  await expect(input(page)).toBeFocused()

  await input(page).fill('cat no')
  await input(page).press('Tab')
  await expect(input(page)).toHaveValue('cat notes ')

  // Several matches: extend as far as they agree and list the choices.
  await input(page).fill('cat us')
  await input(page).press('Tab')
  await expect(input(page)).toHaveValue('cat usage.')
  await expect(output(page)).toContainText('usage.log  usage.old')
})

test('Ctrl-C abandons the line', async ({ page }) => {
  await input(page).pressSequentially('rm -r everything')
  await input(page).press('Control+c')
  await expect(output(page)).toContainText('bench$ rm -r everything^C')
  await expect(input(page)).toHaveValue('')
  await run(page, 'ls')
  await expect(output(page)).toContainText('notes')
})

test('Ctrl-L clears the screen and keeps the line', async ({ page }) => {
  await run(page, 'echo soon gone')
  await input(page).pressSequentially('half typed')
  await input(page).press('Control+l')
  await expect(output(page)).not.toContainText('soon gone')
  await expect(input(page)).toHaveValue('half typed')
  await expect(input(page)).toBeFocused()
})

test('the clear command clears the screen', async ({ page }) => {
  await run(page, 'echo soon gone')
  await run(page, 'clear')
  await expect(output(page)).not.toContainText('soon gone')
})

test('pages long output with more', async ({ page }) => {
  await run(page, 'more long.txt')
  await expect(page.getByText('--More--')).toBeVisible()
  await expect(output(page)).toContainText('This is line 22 of a long file.')
  await expect(output(page)).not.toContainText('This is line 23 of a long file.')

  await page.keyboard.press('Enter')
  await expect(output(page)).toContainText('This is line 23 of a long file.')
  await expect(output(page)).not.toContainText('This is line 24 of a long file.')

  await page.keyboard.press('Space')
  await expect(output(page)).toContainText('This is line 45 of a long file.')

  await page.keyboard.press('q')
  await expect(page.getByText('--More--')).toBeHidden()
  await expect(output(page)).not.toContainText('This is line 46 of a long file.')

  // Back at the prompt, typing works again.
  await run(page, 'echo back')
  await expect(output(page).getByText('back', { exact: true })).toBeVisible()
})

test('clicking the terminal focuses the command line', async ({ page }) => {
  await page.getByRole('heading', { level: 1 }).click()
  await page.getByRole('log', { name: 'Terminal output' }).click()
  await expect(input(page)).toBeFocused()
})

test('keeps the newest output in view', async ({ page }) => {
  await run(page, 'cat long.txt')
  await expect(output(page).getByText('This is line 60 of a long file.')).toBeInViewport()
  await expect(input(page)).toBeInViewport()
})
