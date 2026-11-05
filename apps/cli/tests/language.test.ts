import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clientConfigPath,
  guessLanguage,
  parseLanguage,
  readClientLanguage,
  resolveLanguage,
  writeClientLanguage,
} from '../src/language.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hulala-language-'))
  roots.push(root)
  return root
}

describe('language storage', () => {
  test('accepts the spellings a person may type', () => {
    expect(parseLanguage('en')).toBe('en')
    expect(parseLanguage('English')).toBe('en')
    expect(parseLanguage('zh')).toBe('zh-CN')
    expect(parseLanguage('zh-cn')).toBe('zh-CN')
    expect(parseLanguage('zh_CN')).toBe('zh-CN')
    expect(parseLanguage('中文')).toBe('zh-CN')
    expect(parseLanguage('fr')).toBeUndefined()
  })

  test('writes a compact user-only file and reads it back', () => {
    const root = stateRoot()
    writeClientLanguage(root, 'zh-CN')
    const path = clientConfigPath(root)
    expect(readFileSync(path, 'utf8').trim()).toBe('{"language":"zh-CN"}')
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readClientLanguage(root)).toEqual({ language: 'zh-CN' })
  })

  test('a missing file is unset, not an error', () => {
    expect(readClientLanguage(stateRoot())).toEqual({})
  })

  test('a malformed file is reported instead of silently overwritten', () => {
    const root = stateRoot()
    mkdirSync(join(root, 'config'), { recursive: true })
    writeFileSync(clientConfigPath(root), '{"language":')
    const read = readClientLanguage(root)
    expect(read.language).toBeUndefined()
    expect(read.problem).toBeDefined()
  })

  test('an unknown saved value is reported', () => {
    const root = stateRoot()
    mkdirSync(join(root, 'config'), { recursive: true })
    writeFileSync(clientConfigPath(root), '{"language":"fr"}')
    expect(readClientLanguage(root).problem).toContain('fr')
  })

  test('an unreadable file is reported', () => {
    const root = stateRoot()
    mkdirSync(join(root, 'config'), { recursive: true })
    const path = clientConfigPath(root)
    writeFileSync(path, '{"language":"en"}')
    if (process.platform === 'win32') return
    chmodSync(path, 0o000)
    try {
      expect(readClientLanguage(root).problem).toBeDefined()
    } finally {
      chmodSync(path, 0o600)
    }
  })
})

describe('language resolution', () => {
  test('a saved choice wins when the environment is silent', () => {
    const root = stateRoot()
    writeClientLanguage(root, 'zh-CN')
    expect(resolveLanguage({}, root)).toEqual({ code: 'zh-CN', source: 'config' })
  })

  test('HULALA_LANG overrides the file and is not a save', () => {
    const root = stateRoot()
    writeClientLanguage(root, 'zh-CN')
    const resolved = resolveLanguage({ HULALA_LANG: 'en' }, root)
    expect(resolved).toEqual({ code: 'en', source: 'environment' })
    expect(readClientLanguage(root)).toEqual({ language: 'zh-CN' })
  })

  test('a bad HULALA_LANG is an unset state with a problem, even beside a valid file', () => {
    const root = stateRoot()
    writeClientLanguage(root, 'zh-CN')
    const resolved = resolveLanguage({ HULALA_LANG: 'klingon' }, root)
    expect(resolved.code).toBe('en')
    expect(resolved.source).toBe('unset')
    expect(resolved.problem).toEqual({ kind: 'environment', value: 'klingon' })
  })

  test('a broken file resolves to unset with its reason', () => {
    const root = stateRoot()
    mkdirSync(join(root, 'config'), { recursive: true })
    writeFileSync(clientConfigPath(root), 'not json')
    const resolved = resolveLanguage({}, root)
    expect(resolved.source).toBe('unset')
    expect(resolved.problem?.kind).toBe('config')
  })

  test('a fresh root is unset, not English', () => {
    expect(resolveLanguage({}, stateRoot())).toEqual({ code: 'en', source: 'unset' })
  })

  test('the locale only guesses the cursor', () => {
    expect(guessLanguage({ LANG: 'zh_CN.UTF-8' })).toBe('zh-CN')
    expect(guessLanguage({ LC_ALL: 'zh_TW.UTF-8' })).toBe('zh-CN')
    expect(guessLanguage({ LANG: 'en_US.UTF-8' })).toBe('en')
    expect(guessLanguage({})).toBe('en')
  })

  test('no file is created by reading or resolving', () => {
    const root = stateRoot()
    resolveLanguage({ HULALA_LANG: 'en' }, root)
    expect(existsSync(clientConfigPath(root))).toBe(false)
  })
})
