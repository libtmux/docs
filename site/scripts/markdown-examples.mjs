#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark'
import { ExamplePrograms, SourceBinding, verifyExamplePrograms } from '../src/lib/example-programs.mjs'
import { remarkPortCode } from '../src/plugins/remark-port-code.mjs'

const digest = (value) => createHash('sha256').update(value).digest('hex')
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const json = (path) => JSON.parse(readFileSync(path))
const save = (path, record) => {
  writeFileSync(path + '.tmp', JSON.stringify(record, null, 2) + '\n')
  renameSync(path + '.tmp', path)
}
const reserve = (path, record) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
}

/** Keep stdout and stderr as separate artifacts; a later command cannot hide an earlier failure. */
async function runCommand(argv, cwd, output) {
  const stdout = createWriteStream(output + '.stdout', { flags: 'wx' })
  const stderr = createWriteStream(output + '.stderr', { flags: 'wx' })
  // Open both files before starting a process so a log failure cannot lose its handle.
  await Promise.all([stdout, stderr].map((stream) => new Promise((accept, reject) => {
    stream.once('open', accept)
    stream.once('error', reject)
  })))
  return new Promise((accept, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(stdout)
    child.stderr.pipe(stderr)
    stdout.on('error', reject)
    stderr.on('error', reject)
    child.once('error', reject)
    child.once('close', async (code, signal) => {
      try {
        await Promise.all([stdout, stderr].filter((stream) => !stream.writableFinished).map((stream) =>
          new Promise((done, fail) => { stream.once('finish', done); stream.once('error', fail) })))
        accept({ argv, code, signal, stdout: output + '.stdout', stderr: output + '.stderr' })
      } catch (error) { reject(error) }
    })
  })
}

async function main() {
  const { values, positionals } = parseArgs({ options: Object.fromEntries(
    ['binding', 'recipe', 'receipt', 'render-receipt', 'output-dir', 'program', 'execution-receipt']
      .map((name) => [name, { type: 'string' }])), allowPositionals: true })
  const [mode] = positionals
  requireValue(positionals.length === 1 && ['render', 'run', 'verify'].includes(mode),
    'Usage: markdown-examples.mjs render|run|verify --binding FILE [options]')
  const required = (key) => {
    requireValue(values[key], `Missing --${key}`)
    return values[key]
  }

  if (mode === 'render') {
    const state = new ExamplePrograms({ binding: required('binding'), recipe: required('recipe'), receipt: required('receipt') })
    try {
      const directory = resolve(required('output-dir'))
      requireValue(!existsSync(directory), 'Example rendering requires a new output directory')
      mkdirSync(directory, { recursive: true })
      const renderer = await createMarkdownProcessor({ syntaxHighlight: false,
        remarkPlugins: [state.inputPlugin(), remarkPortCode, state.sourcePlugin()], rehypePlugins: [state.renderedPlugin()] })
      const pages = new Map()
      for (const program of state.programs) {
        requireValue(/\.md$/i.test(program.document), 'The render command accepts Markdown; use Astro to render MDX')
        requireValue(!pages.has(program.rendered) || pages.get(program.rendered) === program.document,
          `Different documents select the same output page: ${program.rendered}`)
        if (pages.has(program.rendered)) continue
        const { content, frontmatter } = parseFrontmatter(state.read(program.document).toString('utf8'))
        const rendered = await renderer.render(content, { fileURL: pathToFileURL(program.document), frontmatter })
        const path = resolve(directory, program.rendered)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, rendered.code, { flag: 'wx' })
        pages.set(program.rendered, program.document)
      }
      state.finish(directory)
    } catch (error) { state.fail(error); throw error }
    return
  }

  const binding = new SourceBinding(required('binding'))
  const renderReceipt = realpathSync(resolve(required('render-receipt')))
  const rendered = verifyExamplePrograms(binding, renderReceipt)
  if (mode === 'verify') {
    if (values['execution-receipt']) {
      const execution = json(values['execution-receipt'])
      requireValue(execution.schema === 1 && execution.producer === 'markdown-execution' && execution.complete === true &&
        execution.passed === true && execution.errors?.length === 0 && execution.renderReceipt === renderReceipt &&
        execution.renderSha256 === rendered.sha256 && execution.runId === binding.binding.runId &&
        execution.bindingSha256 === binding.bindingSha256, 'Execution is incomplete, failed or belongs to another render')
      const program = rendered.record.programs.find((entry) => entry.id === execution.program)
      requireValue(program && execution.commands?.length === program.commands.length, 'Execution command inventory differs')
      for (const [index, command] of execution.commands.entries()) {
        requireValue(command.code === 0 && command.signal === null && isDeepStrictEqual(command.argv, program.commands[index]) &&
          digest(readFileSync(command.stdout)) === command.stdoutSha256 && digest(readFileSync(command.stderr)) === command.stderrSha256,
        `Execution command changed: ${index}`)
      }
      for (const file of program.files) requireValue(digest(readFileSync(resolve(execution.directory, file.path))) === file.sha256,
        `Executed program changed: ${file.path}`)
      checkOutput(program, readFileSync(execution.commands.at(-1).stdout, 'utf8'))
    }
    return
  }

  const program = rendered.record.programs.find((entry) => entry.id === required('program'))
  requireValue(program, `Unknown program: ${values.program}`)
  const directory = resolve(required('output-dir'))
  const receipt = resolve(required('receipt'))
  const record = { schema: 1, producer: 'markdown-execution', runId: binding.binding.runId,
    bindingSha256: binding.bindingSha256, renderReceipt, renderSha256: rendered.sha256,
    program: program.id, directory, complete: false, passed: false, errors: [], commands: [] }
  reserve(receipt, record)
  try {
    requireValue(!existsSync(directory), 'Example execution requires a new output directory')
    mkdirSync(directory, { recursive: true })
    for (const file of program.files) {
      const path = resolve(directory, file.path)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, file.text, { flag: 'wx' })
    }
    // The caller's environment selects native runtimes, package versions and tmux defaults.
    for (const [index, command] of program.commands.entries()) {
      const result = await runCommand(command, directory, resolve(directory, `.command-${index}`))
      result.stdoutSha256 = digest(readFileSync(result.stdout))
      result.stderrSha256 = digest(readFileSync(result.stderr))
      record.commands.push(result)
      save(receipt, record)
      requireValue(result.code === 0 && result.signal === null, `Example command ${index} failed: ${result.signal ?? result.code}`)
    }
    checkOutput(program, readFileSync(record.commands.at(-1).stdout, 'utf8'))
    const after = verifyExamplePrograms(binding, renderReceipt)
    requireValue(after.sha256 === rendered.sha256, 'The render receipt changed during execution')
    for (const file of program.files) requireValue(digest(readFileSync(resolve(directory, file.path))) === file.sha256,
      `The example changed its program: ${file.path}`)
    record.complete = true
    record.passed = true
    save(receipt, record)
  } catch (error) {
    record.errors.push({ type: error.name, message: error.message })
    save(receipt, record)
    throw error
  }
}

function checkOutput(program, actual) {
  if (program.stdout !== undefined) requireValue(actual === program.stdout, `Unexpected stdout for ${program.id}`)
  if (program.stdoutPattern !== undefined) requireValue(new RegExp(`^(?:${program.stdoutPattern})$`, 'u').test(actual),
    `Unexpected stdout for ${program.id}`)
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
