import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from './version.ts'

describe('engine version', () => {
  it('is a semantic version string', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
