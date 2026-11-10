import type { Program } from '../types.ts'

export const clear: Program = {
  name: 'clear',
  path: '/usr/ucb/clear',
  summary: 'clear the screen',
  usage: 'clear',
  run() {
    return { stdout: '', stderr: '', status: 0, effects: [{ type: 'clear' }] }
  },
}
