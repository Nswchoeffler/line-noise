import type { ReactNode } from 'react'

/** Text between backticks becomes code; everything else is plain. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(`[^`]+`)/)
    .filter((part) => part !== '')
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part,
    )
}

/**
 * Story text as written in level files: blank lines separate paragraphs,
 * single line breaks are only wrapping, and `backticks` mark something to
 * type or a file name.
 */
export function RichText({ text }: { text: string }) {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' '))
  return (
    <>
      {paragraphs.map((paragraph, i) => (
        <p key={i}>{inline(paragraph)}</p>
      ))}
    </>
  )
}
