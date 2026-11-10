import { describe, expect, it } from 'vitest'
import { formatGroup, formatPasswd, parseGroup, parsePasswd, UserDb } from './users.ts'

const PASSWD = [
  'root:Zk3v9QpLm2xYw:0:0:System Administrator:/:/bin/sh',
  'alice:Ab1cD2eF3gH4i:101:10:Alice Example, Rm 12:/home/alice:/bin/sh',
  'bob:*:102:10:Bob Example:/home/bob:/bin/sh',
  '',
].join('\n')

const GROUP = ['wheel:*:0:root', 'staff:*:10:', 'ops:*:20:alice,bob', ''].join('\n')

describe('parsePasswd', () => {
  it('reads every field', () => {
    expect(parsePasswd(PASSWD)[1]).toEqual({
      name: 'alice',
      password: 'Ab1cD2eF3gH4i',
      uid: 101,
      gid: 10,
      gecos: 'Alice Example, Rm 12',
      home: '/home/alice',
      shell: '/bin/sh',
    })
  })

  it('skips blank lines, comments and malformed lines', () => {
    const text = '# accounts\n\nbroken:line\nnouid:x:abc:10:::\n:x:1:1:::\n' + PASSWD
    expect(parsePasswd(text).map((u) => u.name)).toEqual(['root', 'alice', 'bob'])
  })

  it('round-trips through formatPasswd', () => {
    expect(formatPasswd(parsePasswd(PASSWD))).toBe(PASSWD)
  })
})

describe('parseGroup', () => {
  it('reads names, ids and members', () => {
    expect(parseGroup(GROUP)).toEqual([
      { name: 'wheel', gid: 0, members: ['root'] },
      { name: 'staff', gid: 10, members: [] },
      { name: 'ops', gid: 20, members: ['alice', 'bob'] },
    ])
  })

  it('skips malformed lines', () => {
    expect(parseGroup('bad\nstaff:*:x:\n' + GROUP)).toHaveLength(3)
  })

  it('round-trips through formatGroup', () => {
    expect(formatGroup(parseGroup(GROUP))).toBe(GROUP)
  })
})

describe('UserDb', () => {
  const db = new UserDb(PASSWD, GROUP)

  it('finds users by name and by uid', () => {
    expect(db.byName('alice')?.uid).toBe(101)
    expect(db.byUid(102)?.name).toBe('bob')
    expect(db.byName('nobody')).toBeUndefined()
  })

  it('finds groups by name and by gid', () => {
    expect(db.groupByName('ops')?.gid).toBe(20)
    expect(db.groupByGid(10)?.name).toBe('staff')
  })

  it('falls back to the number for unknown ids', () => {
    expect(db.userName(101)).toBe('alice')
    expect(db.userName(999)).toBe('999')
    expect(db.groupName(10)).toBe('staff')
    expect(db.groupName(999)).toBe('999')
  })

  it('builds credentials with the primary group and every membership', () => {
    expect(db.credentialsFor('alice')).toEqual({ uid: 101, gid: 10, groups: [10, 20] })
    expect(db.credentialsFor('root')).toEqual({ uid: 0, gid: 0, groups: [0] })
  })

  it('has no credentials for an account that does not exist', () => {
    expect(db.credentialsFor('ghost')).toBeUndefined()
  })
})
