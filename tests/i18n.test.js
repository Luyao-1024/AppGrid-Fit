import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const root = new URL('..', import.meta.url)
const read = name => readFileSync(new URL(name, root), 'utf8')

const prefs = read('prefs.js')
const snapshots = read('snapshots.js')
const metadata = JSON.parse(read('metadata.json'))
const catalog = read('po/zh_CN.po')

function parseCatalog(text) {
    const entries = new Map()
    let msgid = null
    for (const line of text.split('\n')) {
        if (line.startsWith('msgid ')) {
            msgid = JSON.parse(line.slice(6))
        } else if (line.startsWith('msgstr ')) {
            const msgstr = JSON.parse(line.slice(7))
            if (msgid)
                entries.set(msgid, msgstr)
        }
    }
    return entries
}

function extract(source, pattern) {
    return [...source.matchAll(pattern)]
        .map(match => match[1]
            .replaceAll("\\'", "'")
            .replaceAll('\\\\', '\\'))
}

const translations = parseCatalog(catalog)
const used = new Set([
    ...extract(prefs, /_\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g),
    ...extract(snapshots, /gettext\('((?:[^'\\]|\\.)*)'\)/g),
    metadata.name,
    metadata.description,
])
const sizeNames = prefs.match(/const SIZE_NAMES = \[([^\]]+)\]/)?.[1]
    .split(',')
    .map(value => value.trim().replaceAll("'", '')) ?? []
for (const name of sizeNames)
    used.add(name)

function placeholders(message) {
    return [...message.matchAll(/\{(\w+)\}/g)]
        .map(match => match[1])
        .sort()
}

test('Chinese catalog covers every translatable UI string', () => {
    assert.equal(metadata['gettext-domain'], 'appgrid-size@luyao')
    assert.match(read('po/LINGUAS'), /^zh_CN$/m)
    for (const message of used) {
        assert.ok(translations.has(message),
            `missing Chinese translation: ${message}`)
        assert.notEqual(translations.get(message), '',
            `empty Chinese translation: ${message}`)
    }
    for (const message of translations.keys())
        assert.ok(used.has(message), `stale Chinese translation: ${message}`)
})

test('Chinese translations preserve named placeholders', () => {
    for (const [message, translation] of translations) {
        assert.deepEqual(placeholders(translation),
            placeholders(message),
            `placeholder mismatch: ${message}`)
    }
})
