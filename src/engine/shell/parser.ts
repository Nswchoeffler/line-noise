import { ShellSyntaxError, tokenize, type Word } from './lexer.ts'

export interface Redirect {
  op: '>' | '>>' | '<'
  target: Word
}

/** One program invocation: its words (name and arguments) and its redirects. */
export interface SimpleCommand {
  words: Word[]
  redirects: Redirect[]
}

/** Commands joined by `|`, each feeding its output to the next. */
export interface Pipeline {
  commands: SimpleCommand[]
}

/** Parse a line (or a whole script) into pipelines, in the order they run. */
export function parse(source: string): Pipeline[] {
  const pipelines: Pipeline[] = []
  let commands: SimpleCommand[] = []
  let current: SimpleCommand = { words: [], redirects: [] }

  const isEmpty = (c: SimpleCommand): boolean => c.words.length === 0 && c.redirects.length === 0

  const endCommand = (): void => {
    if (current.words.length === 0) throw new ShellSyntaxError('Invalid null command.')
    commands.push(current)
    current = { words: [], redirects: [] }
  }

  const endPipeline = (): void => {
    if (isEmpty(current) && commands.length === 0) return // blank line or stray ";"
    endCommand()
    pipelines.push({ commands })
    commands = []
  }

  const tokens = tokenize(source)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.type === 'word') {
      current.words.push(token.word)
    } else if (token.op === '|') {
      endCommand()
    } else if (token.op === ';') {
      endPipeline()
    } else {
      const target = tokens[i + 1]
      if (!target || target.type !== 'word') {
        throw new ShellSyntaxError('Missing name for redirect.')
      }
      current.redirects.push({ op: token.op, target: target.word })
      i++
    }
  }
  endPipeline()
  return pipelines
}
