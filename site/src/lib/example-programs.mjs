import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { parseFrontmatter } from '@astrojs/markdown-remark'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'

const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const digest = (value) => createHash('sha256').update(value).digest('hex')
const canonical = (path) => realpathSync(resolve(path))
const textOf = (node) => node?.type === 'text' ? node.value : (node?.children ?? []).map(textOf).join('')
const hasClass = (node, name) => node?.properties?.className?.includes(name)

function safeRelative(path, description) {
  requireValue(typeof path === 'string' && path && !isAbsolute(path) && !path.includes('\\') &&
    !path.split('/').some((part) => !part || part === '.' || part === '..'), `Invalid ${description}: ${path}`)
  return path
}

/** Read native code text, including Expressive Code's line and Copy representations. */
export function renderedProgramBlocks(tree, identify = null) {
  const blocks = []
  function walk(node, ancestors) {
    if (node.type === 'element' && node.tagName === 'pre') {
      const code = node.children?.find((child) => child.type === 'element' && child.tagName === 'code')
      if (code) {
        if (identify) node.properties.dataLibtmuxExample = identify(blocks.length)
        const lines = code.children.filter((child) => hasClass(child, 'ec-line'))
        let text = textOf(code).replace(/\n$/, '')
        if (lines.length) {
          text = lines.map((line) => {
            const content = line.children.find((child) => hasClass(child, 'code'))
            requireValue(content, 'Expressive Code line has no code container')
            const raw = textOf(content)
            return raw === '\n' ? '' : raw
          }).join('\n')
        }
        const classes = code.properties?.className ?? []
        const language = node.properties?.dataLanguage ?? classes.find((name) => name.startsWith('language-'))?.slice(9) ?? ''
        const frame = ancestors.findLast((parent) => parent.tagName === 'figure' || hasClass(parent, 'expressive-code'))
        const copies = []
        if (frame) visit(frame, 'element', (child) => {
          if (child.tagName === 'button' && typeof child.properties?.dataCode === 'string') {
            copies.push(child.properties.dataCode.replaceAll('\u007f', '\n'))
          }
        })
        requireValue(copies.length <= 1, 'A rendered code block has ambiguous Copy payloads')
        requireValue(!copies.length || copies[0] === text, 'Displayed code differs from its Copy payload')
        blocks.push({ identity: node.properties?.dataLibtmuxExample ?? null,
          language: String(language).toLowerCase(), text, copiedText: copies[0] ?? null, sha256: digest(text) })
      }
    }
    for (const child of node.children ?? []) walk(child, [...ancestors, node])
  }
  walk(tree, [])
  return blocks
}

/** Each collected element must survive once, in order, with its language and Copy bytes. */
function verifyRenderedBlocks(expected, actual, path) {
  const identities = new Set(expected.map((block) => block.identity))
  requireValue(identities.size === expected.length && expected.every((block) =>
    typeof block.identity === 'string' && /^libtmux-[a-f0-9]{64}-\d+$/.test(block.identity) && digest(block.text) === block.sha256),
  `Invalid collected code identities: ${path}`)
  const selected = actual.filter((block) => identities.has(block.identity))
  requireValue(isDeepStrictEqual(selected, expected), `Final page differs from native collected code: ${path}`)
}

/** Read only the file bytes named by the shared source-binding manifest. */
export class SourceBinding {
  constructor(binding) {
    this.bindingPath = canonical(binding)
    const raw = readFileSync(this.bindingPath)
    this.bindingSha256 = digest(raw)
    this.binding = JSON.parse(raw)
    requireValue(this.binding.schema === 1 && typeof this.binding.runId === 'string' && this.binding.runId,
      'Unsupported example binding or missing run ID')
    requireValue(this.binding.inputs && typeof this.binding.inputs === 'object' && Object.keys(this.binding.inputs).length,
      'An example binding needs input files')
    for (const [path, checksum] of Object.entries(this.binding.inputs)) {
      requireValue(canonical(path) === path && /^[a-f0-9]{64}$/.test(checksum), `Invalid bound input: ${path}`)
    }
    this.verify()
  }

  read(path) {
    const filename = canonical(path)
    requireValue(Object.hasOwn(this.binding.inputs, filename), `Input is absent from the source binding: ${filename}`)
    const raw = readFileSync(filename)
    requireValue(digest(raw) === this.binding.inputs[filename], `Input changed after binding: ${filename}`)
    return raw
  }

  verify() {
    requireValue(digest(readFileSync(this.bindingPath)) === this.bindingSha256, 'The source binding changed during the run')
    for (const path of Object.keys(this.binding.inputs)) this.read(path)
  }
}

/** Bind native Markdown collection and final HTML to an external execution recipe. */
export class ExamplePrograms extends SourceBinding {
  constructor({ binding, recipe, receipt }) {
    super(binding)
    this.recipePath = canonical(recipe)
    this.recipe = JSON.parse(this.read(this.recipePath))
    requireValue(this.recipe.schema === 1 && Array.isArray(this.recipe.programs) && this.recipe.programs.length,
      'An example recipe needs at least one program')
    const ids = new Set()
    this.programs = this.recipe.programs.map((program) => {
      requireValue(typeof program.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(program.id) && !ids.has(program.id),
        `Invalid or repeated program ID: ${program.id}`)
      ids.add(program.id)
      const document = canonical(resolve(dirname(this.recipePath), program.document))
      this.read(document)
      const rendered = safeRelative(program.rendered, 'rendered page path')
      requireValue(rendered.endsWith('.html'), `Expected an HTML page: ${rendered}`)
      requireValue(Array.isArray(program.files) && program.files.length, `Program ${program.id} has no files`)
      const paths = new Set()
      for (const file of program.files) {
        safeRelative(file.path, 'program file path')
        requireValue(!paths.has(file.path), `Program ${program.id} repeats ${file.path}`)
        paths.add(file.path)
        requireValue(typeof file.language === 'string' && file.language && file.language === file.language.toLowerCase() &&
          Number.isSafeInteger(file.block) && file.block >= 0, `Invalid fence selection: ${program.id}/${file.path}`)
      }
      requireValue(Array.isArray(program.commands) && program.commands.length && program.commands.every((command) =>
        Array.isArray(command) && command.length && command[0] && command.every((arg) => typeof arg === 'string' && !arg.includes('\0'))),
      `Program ${program.id} needs native command argument arrays`)
      requireValue(program.stdout === undefined || typeof program.stdout === 'string', `Invalid expected stdout: ${program.id}`)
      requireValue(program.stdoutPattern === undefined || typeof program.stdoutPattern === 'string', `Invalid stdout pattern: ${program.id}`)
      requireValue(program.stdout === undefined || program.stdoutPattern === undefined, `Choose stdout or stdoutPattern: ${program.id}`)
      return { ...program, document, rendered }
    })
    this.path = resolve(receipt)
    this.record = { schema: 1, producer: 'markdown', format: 'html', runId: this.binding.runId,
      bindingSha256: this.bindingSha256, inputs: this.binding.inputs,
      recipe: this.recipePath, recipeSha256: digest(this.read(this.recipePath)),
      complete: false, passed: false, errors: [], documents: {}, rendered: {}, programs: [] }
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.record, null, 2) + '\n', { flag: 'wx' })
  }

  save() {
    writeFileSync(this.path + '.tmp', JSON.stringify(this.record, null, 2) + '\n')
    renameSync(this.path + '.tmp', this.path)
  }

  fail(error) {
    this.record.passed = false
    this.record.errors.push({ type: error.name, message: error.message })
    this.save()
  }

  selected(file) {
    if (!file?.path || !existsSync(file.path)) return null
    const filename = canonical(file.path)
    return this.programs.some((program) => program.document === filename) ? filename : null
  }

  /** Install before authored remark plugins, so cached or substituted input cannot pass as the bound page. */
  inputPlugin() {
    const state = this
    return function boundInput() {
      return (_tree, file) => {
        const path = state.selected(file)
        if (!path) return
        const { content } = parseFrontmatter(state.read(path).toString('utf8'))
        // Astro content collections trim the document body before compilation.
        requireValue(String(file.value).trim() === content.trim(), `Native renderer used different source: ${path}`)
      }
    }
  }

  /** Install after authored remark plugins, including source inclusion and port selection. */
  sourcePlugin() {
    const state = this
    return function collectedSource() {
      return (tree, file) => {
        const path = state.selected(file)
        if (!path) return
        const blocks = []
        visit(tree, 'code', (node) => {
          blocks.push({ language: (node.lang ?? '').toLowerCase(), text: node.value, meta: node.meta ?? null,
            line: node.position?.start.line ?? null, sha256: digest(node.value) })
        })
        const previous = state.record.documents[path]
        const includedSources = (file.data.libtmuxSourceIncludes ?? []).map((included) => {
          const raw = state.read(included.path)
          requireValue(isDeepStrictEqual(JSON.parse(raw)[included.key], included.entry),
            `Native source include differs from its binding: ${included.key}`)
          return { path: canonical(included.path), key: included.key, sha256: digest(raw),
            revision: included.entry.revision, contentSha256: digest(included.entry.content) }
        })
        requireValue(!previous || JSON.stringify(previous.sourceBlocks) === JSON.stringify(blocks),
          `Repeated collection differs for ${path}`)
        requireValue(!previous || isDeepStrictEqual(previous.includedSources, includedSources),
          `Repeated source inclusion differs for ${path}`)
        state.record.documents[path] = { ...previous, sourceSha256: state.binding.inputs[path], sourceBlocks: blocks, includedSources }
        state.save()
      }
    }
  }

  /** Install after native highlighting; final HTML verification still runs after MDX evaluation. */
  renderedPlugin() {
    const state = this
    return function collectedRender() {
      return (tree, file) => {
        const path = state.selected(file)
        if (!path) return
        const document = state.record.documents[path]
        requireValue(document, `No native source collection for ${path}`)
        const documentIdentity = digest(`${path}\0${document.sourceSha256}`)
        const blocks = renderedProgramBlocks(tree, (index) => `libtmux-${documentIdentity}-${index}`)
        requireValue(!document.renderedBlocks || JSON.stringify(document.renderedBlocks) === JSON.stringify(blocks),
          `Repeated rendering differs for ${path}`)
        for (const program of state.programs.filter((entry) => entry.document === path)) {
          for (const file of program.files) {
            const source = document.sourceBlocks.filter((block) => block.language === file.language)
            const rendered = blocks.filter((block) => block.language === file.language)
            requireValue(source.length === rendered.length && file.block < source.length,
              `Fence selection is missing or ambiguous: ${program.id}/${file.path}`)
          }
        }
        document.renderedBlocks = blocks
        state.save()
      }
    }
  }

  finish(outputDirectory) {
    this.verify()
    requireValue(!this.record.complete && !this.record.programs.length, 'A render receipt can only be completed once')
    this.record.outputDirectory = canonical(outputDirectory)
    const checked = new Map()
    for (const program of this.programs) {
      const document = this.record.documents[program.document]
      requireValue(document?.renderedBlocks, `Native renderer did not collect ${program.document}`)
      const path = canonical(resolve(outputDirectory, program.rendered))
      const key = `${program.document}\0${path}`
      if (!checked.has(key)) {
        const raw = readFileSync(path)
        const actual = renderedProgramBlocks(fromHtml(raw.toString('utf8')))
        verifyRenderedBlocks(document.renderedBlocks, actual, path)
        this.record.rendered[path] = { sha256: digest(raw) }
        checked.set(key, true)
      }
      this.record.programs.push({ ...program, renderedPath: path,
        files: program.files.map((file) => {
          const source = document.sourceBlocks.filter((block) => block.language === file.language)[file.block]
          const rendered = document.renderedBlocks.filter((block) => block.language === file.language)[file.block]
          return { ...file, identity: rendered.identity, authoredText: source.text, authoredSha256: source.sha256,
            text: rendered.text, sha256: rendered.sha256, copiedText: rendered.copiedText }
        }) })
    }
    this.verify()
    this.record.complete = true
    this.record.passed = true
    this.save()
  }
}

/** Enable the adapter only for an explicitly configured native example build. */
export function exampleProgramsFromEnvironment(environment = process.env) {
  const values = ['LIBTMUX_EXAMPLE_BINDING', 'LIBTMUX_EXAMPLE_RECIPE', 'LIBTMUX_EXAMPLE_RENDER_RECEIPT'].map((key) => environment[key])
  if (values.every((value) => !value)) return null
  requireValue(values.every(Boolean), 'Set LIBTMUX_EXAMPLE_BINDING, LIBTMUX_EXAMPLE_RECIPE and LIBTMUX_EXAMPLE_RENDER_RECEIPT together')
  return new ExamplePrograms({ binding: values[0], recipe: values[1], receipt: values[2] })
}

/** Add observers to the configured native Astro pipeline without changing example bodies. */
export function exampleProgramsIntegration(state) {
  if (!state) return []
  const cacheDirectory = state.path + '.astro-cache'
  return [{ name: 'libtmux:example-programs', hooks: {
    'astro:config:setup': ({ updateConfig }) => {
      // Content collections can reuse HTML without running remark/rehype.
      // A verification build needs fresh collection, with a cache of its own.
      mkdirSync(cacheDirectory)
      updateConfig({ cacheDir: pathToFileURL(cacheDirectory + '/') })
    },
    'astro:config:done': ({ config }) => {
      requireValue(!existsSync(config.outDir), 'Example rendering requires a new Astro output directory')
      requireValue(canonical(fileURLToPath(config.cacheDir)) === canonical(cacheDirectory),
        'Example rendering requires its own fresh Astro cache directory')
      state.record.cacheDirectory = canonical(cacheDirectory)
      state.save()
      const processor = config.markdown.processor
      requireValue(processor?.name === 'unified', 'Example binding requires the configured unified Markdown processor')
      processor.options.remarkPlugins.unshift(state.inputPlugin())
      processor.options.remarkPlugins.push(state.sourcePlugin())
      processor.options.rehypePlugins.push(state.renderedPlugin())
    },
    'astro:build:done': ({ dir }) => {
      try { state.finish(fileURLToPath(dir)) } catch (error) { state.fail(error); throw error }
    },
  } }]
}

/** Recheck native collection, recipe, final HTML and code bytes before an example runs. */
export function verifyExamplePrograms(binding, receipt) {
  binding.verify()
  const raw = readFileSync(receipt)
  const record = JSON.parse(raw)
  requireValue(record.schema === 1 && record.producer === 'markdown' && record.format === 'html' &&
    record.complete === true && record.passed === true && Array.isArray(record.errors) && !record.errors.length,
  `Native rendering is incomplete or failed: ${receipt}`)
  requireValue(record.runId === binding.binding.runId && record.bindingSha256 === binding.bindingSha256 &&
    isDeepStrictEqual(record.inputs, binding.binding.inputs), `Native rendering belongs to different inputs: ${receipt}`)
  const recipeRaw = binding.read(record.recipe)
  requireValue(digest(recipeRaw) === record.recipeSha256, 'The example recipe changed after rendering')
  const recipe = JSON.parse(recipeRaw)
  requireValue(recipe.schema === 1 && Array.isArray(recipe.programs) && recipe.programs.length &&
    record.programs?.length === recipe.programs.length, 'Rendered program inventory differs from its recipe')
  const checked = new Set()
  for (const [index, program] of record.programs.entries()) {
    const expected = recipe.programs[index]
    const documentPath = canonical(resolve(dirname(record.recipe), expected.document))
    const document = record.documents?.[documentPath]
    requireValue(document && digest(binding.read(documentPath)) === document.sourceSha256, `Missing collected source: ${documentPath}`)
    for (const included of document.includedSources) {
      const raw = binding.read(included.path)
      const entry = JSON.parse(raw)[included.key]
      requireValue(digest(raw) === included.sha256 && entry?.revision === included.revision &&
        digest(entry.content) === included.contentSha256, `Source include changed: ${included.key}`)
    }
    requireValue(program.id === expected.id && program.document === documentPath &&
      program.rendered === expected.rendered && isDeepStrictEqual(program.commands, expected.commands) &&
      program.stdout === expected.stdout && program.stdoutPattern === expected.stdoutPattern &&
      program.files?.length === expected.files?.length, `Rendered recipe differs for ${expected.id}`)
    safeRelative(program.rendered, 'rendered page path')
    const page = canonical(resolve(record.outputDirectory, program.rendered))
    requireValue(program.renderedPath === page, `Rendered page differs for ${program.id}`)
    const key = `${documentPath}\0${page}`
    if (!checked.has(key)) {
      const html = readFileSync(page)
      requireValue(digest(html) === record.rendered?.[page]?.sha256, `Rendered page changed after collection: ${page}`)
      const blocks = renderedProgramBlocks(fromHtml(html.toString('utf8')))
      verifyRenderedBlocks(document.renderedBlocks, blocks, page)
      checked.add(key)
    }
    for (const [fileIndex, file] of program.files.entries()) {
      const selection = expected.files[fileIndex]
      safeRelative(file.path, 'program file path')
      const source = document.sourceBlocks.filter((block) => block.language === selection.language)
      const rendered = document.renderedBlocks.filter((block) => block.language === selection.language)
      requireValue(file.path === selection.path && file.language === selection.language && file.block === selection.block &&
        source.length === rendered.length && Number.isSafeInteger(selection.block) && selection.block >= 0 && selection.block < source.length,
      `Rendered file selection differs: ${program.id}/${file.path}`)
      requireValue(file.authoredText === source[file.block].text && digest(file.authoredText) === file.authoredSha256 &&
        file.identity === rendered[file.block].identity && file.text === rendered[file.block].text &&
        digest(file.text) === file.sha256 && file.copiedText === rendered[file.block].copiedText,
      `Rendered program bytes differ: ${program.id}/${file.path}`)
    }
  }
  binding.verify()
  return { record, sha256: digest(raw) }
}
