import {execFileSync} from 'node:child_process'
import {
    existsSync,
    readFileSync,
    readdirSync,
} from 'node:fs'
import {basename, dirname, resolve} from 'node:path'

const args = process.argv.slice(2)
let sourceDir = resolve('.')
let archivePath = null
const errors = []

for (let index = 0; index < args.length; index++) {
    if (args[index] === '--source')
        sourceDir = resolve(args[++index] ?? '')
    else if (args[index] === '--archive')
        archivePath = resolve(args[++index] ?? '')
    else
        errors.push(`Unknown argument: ${args[index]}`)
}

function check(condition, message) {
    if (!condition)
        errors.push(message)
}

function readText(path) {
    try {
        return readFileSync(path, 'utf8')
    } catch (error) {
        errors.push(`Cannot read ${path}: ${error.message}`)
        return ''
    }
}

function readJson(path) {
    const text = readText(path)
    try {
        return {text, value: JSON.parse(text)}
    } catch (error) {
        errors.push(`Invalid JSON in ${path}: ${error.message}`)
        return {text, value: {}}
    }
}

const metadataPath = resolve(sourceDir, 'metadata.json')
const packagePath = resolve(sourceDir, 'package.json')
const metadata = readJson(metadataPath)
const packageJson = readJson(packagePath)
const uuidPattern = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/
const versionNamePattern = /^\d+\.\d+\.\d+$/

check(uuidPattern.test(metadata.value.uuid ?? ''),
    'metadata.json uuid must use the name@domain format')
check(typeof metadata.value.name === 'string' && metadata.value.name.trim(),
    'metadata.json name must be a non-empty string')
check(typeof metadata.value.description === 'string' &&
    metadata.value.description.trim(),
    'metadata.json description must be a non-empty string')
check(Number.isInteger(metadata.value.version) && metadata.value.version > 0,
    'metadata.json version must be a positive integer')
check(versionNamePattern.test(metadata.value['version-name'] ?? ''),
    'metadata.json version-name must be a semantic x.y.z version')
check(metadata.value['version-name'] === packageJson.value.version,
    'metadata.json version-name must match package.json version')
check(Array.isArray(metadata.value['shell-version']) &&
    metadata.value['shell-version'].length > 0 &&
    metadata.value['shell-version'].every(version =>
        typeof version === 'string' && /^\d+(\.\d+)?$/.test(version)),
    'metadata.json shell-version must contain GNOME version strings')
check(new Set(metadata.value['shell-version'] ?? []).size ===
    (metadata.value['shell-version'] ?? []).length,
    'metadata.json shell-version entries must be unique')
check(typeof metadata.value.url === 'string' &&
    metadata.value.url.startsWith('https://'),
    'metadata.json url must use HTTPS')
check(typeof metadata.value['settings-schema'] === 'string' &&
    metadata.value['settings-schema'].length > 0,
    'metadata.json settings-schema must be a non-empty string')

const schemaName = metadata.value['settings-schema'] ?? ''
const schemaPath = resolve(sourceDir, 'schemas', `${schemaName}.gschema.xml`)
const schemaText = readText(schemaPath)
check(schemaText.includes(`<schema id="${schemaName}"`),
    'The declared settings schema ID must exist in schemas/')
check(schemaText.includes('path="/org/gnome/shell/extensions/'),
    'The settings schema must use an extension-specific path')
check(existsSync(resolve(sourceDir, 'extension.js')),
    'extension.js is required')
check(existsSync(resolve(sourceDir, 'LICENSE')),
    'LICENSE is required for review')

const extensionSource = readText(resolve(sourceDir, 'extension.js'))
const prefsSource = readText(resolve(sourceDir, 'prefs.js'))
check(/export\s+default\s+class\s+\w+\s+extends\s+Extension\b/.test(
    extensionSource),
    'extension.js must default-export an Extension subclass')
check(/export\s+default\s+class\s+\w+\s+extends\s+ExtensionPreferences\b/.test(
    prefsSource),
    'prefs.js must default-export an ExtensionPreferences subclass')

const readmeText = readText(resolve(sourceDir, 'README.md'))
const changelogText = readText(resolve(sourceDir, 'CHANGELOG.md'))
check(readmeText.includes(`Current version: **${metadata.value['version-name']}**`),
    'README current version must match metadata.json')
check(changelogText.includes(`## ${metadata.value['version-name']} —`),
    'CHANGELOG must contain the current version heading')

const runtimeFiles = readdirSync(sourceDir)
    .filter(name => name.endsWith('.js'))
const forbiddenPatterns = [
    [/\beval\s*\(/, 'eval()'],
    [/\bnew\s+Function\b/, 'new Function'],
    [/\bGio\.Subprocess\b/, 'Gio.Subprocess'],
    [/\bGLib\.spawn(?:_async|_sync|_command_line_async|_command_line_sync)?\b/,
        'GLib process spawning'],
    [/\bUtil\.spawn(?:CommandLine)?\b/, 'Shell command spawning'],
    [/\bglobal\.reexec_self\b/, 'Shell self-restart'],
    [/\bMeta\.restart\b/, 'Shell restart'],
    [/\bimports\./, 'legacy imports.* module API'],
    [/\b(?:require|process\.exit)\s*\(/, 'Node-only runtime API'],
    [/\b(?:https?:\/\/|data:)/, 'remote or embedded code URL'],
]
const localImports = new Set()

for (const fileName of runtimeFiles) {
    const filePath = resolve(sourceDir, fileName)
    const source = readText(filePath)
    const longLine = source.split('\n').findIndex(line => line.length > 500)
    check(longLine === -1,
        `${fileName}:${longLine + 1} looks minified or generated`)
    for (const [pattern, label] of forbiddenPatterns)
        check(!pattern.test(source), `${fileName} uses review-sensitive ${label}`)

    const importPattern = /\bfrom\s+['"]([^'"]+)['"]/g
    for (const match of source.matchAll(importPattern)) {
        const specifier = match[1]
        const allowed = specifier.startsWith('./') ||
            specifier.startsWith('gi://') ||
            specifier.startsWith('resource:///org/gnome/')
        check(allowed, `${fileName} imports unsupported module ${specifier}`)
        if (specifier.startsWith('./')) {
            const importedPath = resolve(dirname(filePath), specifier)
            check(existsSync(importedPath),
                `${fileName} imports missing local file ${specifier}`)
            localImports.add(specifier.slice(2))
        }
    }
}

if (archivePath) {
    check(existsSync(archivePath), `Archive does not exist: ${archivePath}`)
    let entries = []
    let archiveMetadata = ''
    try {
        entries = execFileSync('unzip', ['-Z1', archivePath], {
            encoding: 'utf8',
        }).split('\n').filter(Boolean)
        archiveMetadata = execFileSync(
            'unzip', ['-p', archivePath, 'metadata.json'], {encoding: 'utf8'})
    } catch (error) {
        errors.push(`Cannot inspect archive: ${error.message}`)
    }

    check(basename(archivePath) ===
        `${metadata.value.uuid}.shell-extension.zip`,
    'Archive filename must match the extension UUID')
    check(archiveMetadata === metadata.text,
        'Packaged metadata.json must match the source file')

    const requiredEntries = [
        'metadata.json',
        'extension.js',
        'prefs.js',
        'LICENSE',
        `schemas/${schemaName}.gschema.xml`,
        ...localImports,
    ]
    for (const entry of requiredEntries)
        check(entries.includes(entry), `Archive is missing ${entry}`)

    for (const entry of entries) {
        const pathParts = entry.replace(/\\/g, '/').split('/')
        check(!entry.startsWith('/') && !pathParts.includes('..'),
            `Archive contains unsafe path ${entry}`)
        check(!pathParts.some(part => part.startsWith('.') && part !== '.'),
            `Archive contains hidden path ${entry}`)
        check(!/(^|\/)(tests?|docs?|images?|node_modules)(\/|$)/i.test(entry),
            `Archive contains development-only path ${entry}`)
        check(!/(^|\/)(package(?:-lock)?\.json|AGENTS\.md|README\.md)$/i.test(entry),
            `Archive contains development-only file ${entry}`)
        check(!/\.(?:so|dll|dylib|exe|bin|zip|tar|gz|xz|min\.js)$/i.test(entry),
            `Archive contains binary, nested archive, or minified code ${entry}`)
    }
}

if (errors.length) {
    for (const error of errors)
        console.error(`ERROR: ${error}`)
    process.exitCode = 1
} else {
    console.log(archivePath
        ? 'GNOME extension source and package checks passed'
        : 'GNOME extension source checks passed')
}
