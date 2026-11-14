import { h, select } from 'astro-expressive-code/hast'
import { lineNumbers, parseLines, requestedCap, roleLabel } from '../lib/code-frame.mjs'

/**
 * Expressive Code plugin: what a code frame says about its code.
 *
 * - A role label after the file name: "Excerpt · lines 59–78" or "Complete
 *   program" (`role` and `lines` in the fence's info string).
 * - The source's own line numbers on an excerpt, so a reader can find the
 *   lines in the tested file. The numbers sit in a gutter, outside the code,
 *   so Copy never has them.
 * - A line cap (`height="16"`) for a long program or output: the frame stops
 *   at that many lines, scrolls inside, and a bar under it says how many it
 *   shows and offers the rest. Copy always copies every line, and print
 *   shows every line.
 *
 * The numbers, the label and the cap bar are chrome, so search skips them.
 *
 * `lib/code-frame.mjs` defines the info string and the rules; this draws them.
 */

/** A short, stable id for a frame's code, so a cap bar can name the code it controls. */
function frameId(code, groupIndex) {
  let hash = 0x811c9dc5
  for (let index = 0; index < code.length; index++) hash = Math.imul(hash ^ code.charCodeAt(index), 0x01000193)
  return `cap-${groupIndex ?? 0}-${(hash >>> 0).toString(36)}`
}

export function codeFrame() {
  /** @type {WeakMap<object, (number | undefined)[]>} */
  const numbered = new WeakMap()
  return {
    name: 'code-frame',
    baseStyles: `
      /* The role label, after the file name. */
      .frame .header .role { align-self: center; padding-inline: 0.75rem; font-size: 0.8125rem; font-weight: 400; line-height: 1.3; color: var(--color-foreground-muted, var(--color-muted)); }
      .frame .header .role b { font-weight: 600; color: var(--text-color, inherit); }
      /* An excerpt is part of a program, so its header rule is dashed. */
      .frame[data-role='excerpt'] .header { background-image: none; border-bottom: 1px dashed var(--ec-frm-edTabBarBrdBtmCol); }
      /* The source's line numbers, one width on every row. */
      .ec-line .gutter .ln { box-sizing: content-box; width: var(--ln-width, 2ch); padding-inline: 1rem 0; text-align: end; color: var(--color-foreground-muted, var(--color-muted)); user-select: none; -webkit-user-select: none; }
      .ec-line .gutter ~ .code { --ecGtrBrdWd: 0px; padding-inline-start: calc(var(--ecIndent, 0ch) + 1.25ch); }
      /* A cap on a long frame, where a script can lift it. Without one the frame shows every line. */
      @media (scripting: enabled) {
        .frame[data-cap] { scroll-margin-top: 4rem; }
        .frame[data-cap] pre { max-height: calc(var(--cap-lines) * var(--ec-codeLineHt) * var(--ec-codeFontSize) + 2 * var(--ec-codePadBlk)); overflow-y: auto; scrollbar-gutter: stable; border-end-start-radius: 0; border-end-end-radius: 0; }
        .frame[data-cap][data-expanded] pre { max-height: none; overflow-y: visible; }
        .cap { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.375rem 0.75rem 0.375rem 1rem; border: var(--ec-brdWd) solid var(--ec-brdCol); border-top: 0; border-end-start-radius: calc(var(--ec-brdRad) + var(--ec-brdWd)); border-end-end-radius: calc(var(--ec-brdRad) + var(--ec-brdWd)); background: var(--color-surface, var(--color-background-secondary)); font-size: 0.8125rem; line-height: 1.5; color: var(--color-foreground-muted, var(--color-muted)); }
        .cap-count[hidden] + button { margin-inline-start: auto; }
        .cap button { padding: 0.2rem 0.5rem; border: 1px solid var(--control-border, color-mix(in oklab, var(--text-color, currentColor) 60%, var(--background-color, transparent))); border-radius: 0.25rem; background: var(--background-color, transparent); color: var(--text-color, inherit); font: inherit; cursor: pointer; }
        .cap button:hover:not(:disabled) { color: var(--color-link, inherit); border-color: currentColor; }
        .cap button:focus-visible { outline: 2px solid var(--focus-ring-color, var(--color-link, currentColor)); outline-offset: 2px; }
        .cap button:disabled { cursor: progress; }
      }
      @media (scripting: none) { .cap { display: none; } }
      /* Print shows every line, wrapped, and drops the bar. */
      @media print {
        .frame[data-cap] pre { max-height: none !important; overflow: visible !important; }
        .cap { display: none !important; }
        pre .ec-line .code { white-space: pre-wrap; overflow-wrap: anywhere; }
      }
    `,
    // Custom modules follow the built-in frame module in the same bundle.
    jsModules: [`(() => {
      function ready(root) {
        root.querySelectorAll?.('.expressive-code button[data-cap-pending]').forEach(button => {
          button.disabled = false;
          button.removeAttribute('data-cap-pending');
        });
      }
      ready(document);
      new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(ready));
      }).observe(document.body, { childList: true, subtree: true });
      document.addEventListener('astro:page-load', () => ready(document));
      document.addEventListener('click', event => {
        const button = event.target.closest?.('.expressive-code button[data-cap-toggle]');
        if (!button) return;
        const frame = button.closest('.frame');
        const open = button.getAttribute('aria-expanded') !== 'true';
        frame.toggleAttribute('data-expanded', open);
        button.setAttribute('aria-expanded', String(open));
        button.textContent = open ? 'Show fewer lines' : 'Show all ' + button.getAttribute('data-total') + ' lines';
        const count = frame.querySelector('.cap-count');
        if (count) count.hidden = open;
        if (!open) {
          const pre = frame.querySelector('pre');
          if (pre) pre.scrollTop = 0;
          if (frame.getBoundingClientRect().top < 0) frame.scrollIntoView({ block: 'start' });
        }
      });
    })();`],
    hooks: {
      postprocessRenderedLine: ({ codeBlock, lineIndex, renderData }) => {
        const role = codeBlock.metaOptions.getString('role')
        if (role !== 'excerpt') return
        if (!numbered.has(codeBlock)) {
          numbered.set(codeBlock, lineNumbers(parseLines(codeBlock.metaOptions.getString('lines')), codeBlock.getLines().length) ?? [])
        }
        const number = numbered.get(codeBlock)?.[lineIndex]
        // A frame whose rows the lines do not describe has no numbers at all; a blank row between ranges has an empty cell.
        if (!numbered.get(codeBlock)?.length) return
        const cell = h('div.ln', { 'aria-hidden': 'true' }, number === undefined ? [] : [String(number)])
        renderData.lineAst.children.unshift(h('div.gutter', { 'data-pagefind-ignore': '' }, [cell]))
      },
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const figure = select('figure.frame', renderData.blockAst)
        const pre = select('pre', renderData.blockAst)
        if (!figure || !pre) return
        const role = codeBlock.metaOptions.getString('role')
        const ranges = parseLines(codeBlock.metaOptions.getString('lines'))

        const label = roleLabel(role, ranges)
        const header = select('figcaption.header', figure)
        if (label && header && select('.title', header)?.children.length) {
          header.children.push(h('span.role', { 'data-pagefind-ignore': '' }, [h('b', label.name), ...(label.detail ? [` \u00b7 ${label.detail}`] : [])]))
          figure.properties.dataRole = role
        }

        const rows = numbered.get(codeBlock)
        if (rows?.length) {
          const digits = String(Math.max(...rows.filter((row) => row !== undefined))).length
          pre.properties.style = [pre.properties.style, `--ln-width: ${digits}ch`].filter(Boolean).join(';')
        }

        const total = codeBlock.getLines().length
        const cap = requestedCap({ height: codeBlock.metaOptions.getString('height'), role }, total)
        if (!cap) return
        const id = frameId(codeBlock.code, codeBlock.parentDocument?.positionInDocument?.groupIndex)
        figure.properties.dataCap = String(cap)
        figure.properties.style = [figure.properties.style, `--cap-lines: ${cap}`].filter(Boolean).join(';')
        pre.properties.id = id
        const bar = h('div.cap', { 'data-pagefind-ignore': '' }, [
          h('span.cap-count', `${cap} of ${total} lines`),
          h('button', {
            type: 'button', disabled: true, 'data-cap-pending': '', 'data-cap-toggle': '', 'data-total': String(total),
            'aria-expanded': 'false', 'aria-controls': id,
          }, `Show all ${total} lines`),
        ])
        // After the code, before Copy, so the bar sits inside the frame's border.
        const at = figure.children.indexOf(pre)
        figure.children.splice(at + 1, 0, bar)
      },
    },
  }
}
