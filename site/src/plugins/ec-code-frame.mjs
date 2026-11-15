import { h, select } from 'astro-expressive-code/hast'
import { formatLines, lineNumbers, parseLines, rangeFragment, requestedCap, roleLabel } from '../lib/code-frame.mjs'

/**
 * Expressive Code plugin: what a code frame says about its code.
 *
 * - A role label after the file name: "Excerpt · lines 59–78" or "Complete
 *   program" (`role` and `lines` in the fence's info string).
 * - The source's own line numbers on an excerpt, so a reader can find the
 *   lines in the tested file. The numbers hang in a rail outside the frame, at a
 *   negative margin, and never in the code's padding (records 0055, 0058): the
 *   layout states its free margin in `--code-hang-room` and a frame whose rail
 *   needs more moves in by the difference. The rail is a sibling of the `<pre>`,
 *   so the pre's overflow does not clip it; it follows a capped frame's vertical
 *   scroll and stays put when the code scrolls sideways. Copy never has the
 *   numbers.
 * - On the complete program an excerpt of the page cites (`cite`), the same
 *   numbers from line 1. The excerpt's range links to its lines (`#L63-L72`),
 *   which highlight on arrival. A program nothing cites stays unnumbered,
 *   because it is for copying (record 0054).
 * - A line cap (`height="16"`) for a long program or output: the frame stops
 *   at that many lines, scrolls inside, and a bar under it says how many it
 *   shows and offers the rest. Copy always copies every line, and print
 *   shows every line.
 * - `copy="off"` removes the frame's own Copy button, for a component that draws
 *   one of its own, so a frame has one copy control.
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
  /** @type {WeakMap<object, Map<number, string>>} */
  const anchors = new WeakMap()

  /** The source line of each row: an excerpt's range, or every line of a program an excerpt cites. Empty when the frame shows no numbers. */
  function rowsOf(codeBlock) {
    let rows = numbered.get(codeBlock)
    if (!rows) {
      const role = codeBlock.metaOptions.getString('role')
      const count = codeBlock.getLines().length
      rows = (role === 'excerpt' ? lineNumbers(parseLines(codeBlock.metaOptions.getString('lines')), count)
        : role === 'program' && parseLines(codeBlock.metaOptions.getString('cite')).length ? lineNumbers([{ start: 1, end: count }], count)
          : undefined) ?? []
      numbered.set(codeBlock, rows)
    }
    return rows
  }

  /** The fragment each cited range starts at, so a link lands on its first row. A row has one id; the first range to start there takes it. */
  function anchorsOf(codeBlock) {
    let found = anchors.get(codeBlock)
    if (!found) {
      found = new Map()
      if (codeBlock.metaOptions.getString('role') === 'program') {
        for (const range of parseLines(codeBlock.metaOptions.getString('cite'))) {
          if (!found.has(range.start)) found.set(range.start, rangeFragment(range))
        }
      }
      anchors.set(codeBlock, found)
    }
    return found
  }

  return {
    name: 'code-frame',
    baseStyles: `
      /* The role label, after the file name. */
      .frame .header .role { align-self: center; padding-inline: 0.75rem; font-size: 0.8125rem; font-weight: 400; line-height: 1.3; color: var(--color-foreground-muted, var(--color-muted)); }
      .frame .header .role b { font-weight: 600; color: var(--text-color, inherit); }
      /* An excerpt is part of a program, so its header rule is dashed. */
      .frame[data-role='excerpt'] .header { background-image: none; border-bottom: 1px dashed var(--ec-frm-edTabBarBrdBtmCol); }
      /* The lines an excerpt's range link points at, on arrival. The first row also takes :target where a script has not run. */
      .ec-line[id] { scroll-margin-top: 5rem; }
      .ec-line[data-hit], .ec-line:target { background: var(--color-highlight-on-target, color-mix(in srgb, var(--color-link, currentColor) 14%, transparent)); }
      @media (forced-colors: active) { .ec-line[data-hit], .ec-line:target { outline: 2px solid Highlight; outline-offset: -2px; } }
      .frame .header .role a { color: var(--color-link, inherit); text-decoration: underline dotted; text-underline-offset: 0.2em; }
      .frame .header .role a:hover { text-decoration-style: solid; }
      /*
       * The source's line numbers hang in a rail outside the frame at a negative margin, and never in the code's padding
       * (record 0058). A layout states the margin it leaves left of its frames in --code-hang-room (default 1rem); a frame
       * whose rail needs more moves in by the difference, so the numbers stay on the page. The rail is the width of the numbers
       * and a gap of 1.25 characters; the move counts them as 0.6em characters of the code's font, which the frame's own
       * font is not, plus a quarter rem. The rail is positioned where it would sit in flow, so it meets the top of the code
       * whatever the header's height.
       */
      .frame > .rail { position: absolute; z-index: 1; box-sizing: border-box; overflow: hidden; width: var(--ln-width, 2ch); inset-inline-start: calc(-1 * (var(--ln-width, 2ch) + 1.25ch)); color: var(--color-foreground-muted, var(--color-muted)); font-family: var(--ec-codeFontFml); font-size: var(--ec-codeFontSize); line-height: var(--ec-codeLineHt); font-variant-numeric: tabular-nums; user-select: none; -webkit-user-select: none; pointer-events: none; }
      .frame:has(> .rail) { margin-inline-start: max(0px, calc((var(--ln-digits, 2) + 1.25) * 0.6 * var(--ec-codeFontSize) + 0.25rem - var(--code-hang-room, 1rem))); }
      .frame:not(.has-title) > .rail { margin-block-start: var(--ec-brdWd); }
      .frame > .rail .rail-in { padding-block: var(--ec-codePadBlk); }
      .frame > .rail .ln { display: block; height: calc(var(--ec-codeLineHt) * var(--ec-codeFontSize)); text-align: end; }
      /* A cap on a long frame, where a script can lift it. Without one the frame shows every line. */
      @media (scripting: enabled) {
        .frame[data-cap] { scroll-margin-top: 4rem; }
        .frame[data-cap] pre { max-height: calc(var(--cap-lines) * var(--ec-codeLineHt) * var(--ec-codeFontSize) + 2 * var(--ec-codePadBlk)); overflow-y: auto; scrollbar-gutter: stable; border-end-start-radius: 0; border-end-end-radius: 0; }
        .frame[data-cap][data-expanded] pre { max-height: none; overflow-y: visible; }
        .frame[data-cap] > .rail { max-height: calc(var(--cap-lines) * var(--ec-codeLineHt) * var(--ec-codeFontSize) + 2 * var(--ec-codePadBlk)); }
        .frame[data-cap][data-expanded] > .rail { max-height: none; }
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
        .frame > .rail { display: none; }
        .frame:has(> .rail) { margin-inline-start: 0; }
        pre .ec-line .code { white-space: pre-wrap; overflow-wrap: anywhere; }
      }
    `,
    // Custom modules follow the built-in frame module in the same bundle.
    jsModules: [`(() => {
      // The rail of a capped frame follows the code's vertical scroll and ends where the code's visible rows end,
      // above the code's own scrollbar, which comes and goes with the width.
      function followCode(pre) {
        const rail = pre?.parentElement?.querySelector(':scope > .rail');
        if (!rail) return;
        rail.firstElementChild.style.transform = 'translateY(' + -pre.scrollTop + 'px)';
        if (pre.clientHeight) rail.style.height = pre.clientHeight + 'px';
      }
      const watched = new WeakSet();
      function ready(root) {
        root.querySelectorAll?.('.expressive-code button[data-cap-pending]').forEach(button => {
          button.disabled = false;
          button.removeAttribute('data-cap-pending');
        });
        root.querySelectorAll?.('.frame[data-cap] pre').forEach(pre => {
          if (watched.has(pre)) return;
          watched.add(pre);
          followCode(pre);
          if (typeof ResizeObserver === 'function') new ResizeObserver(() => followCode(pre)).observe(pre);
        });
      }
      ready(document);
      new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(ready));
      }).observe(document.body, { childList: true, subtree: true });
      document.addEventListener('astro:page-load', () => ready(document));
      function setExpanded(button, open) {
        const frame = button.closest('.frame');
        frame.toggleAttribute('data-expanded', open);
        button.setAttribute('aria-expanded', String(open));
        button.textContent = open ? 'Show fewer lines' : 'Show all ' + button.getAttribute('data-total') + ' lines';
        const count = frame.querySelector('.cap-count');
        if (count) count.hidden = open;
        const pre = frame.querySelector('pre');
        if (!open && pre) pre.scrollTop = 0;
        followCode(pre);
        if (!open && frame.getBoundingClientRect().top < 0) frame.scrollIntoView({ block: 'start' });
      }
      // A scroll does not bubble, so the capture phase hears every frame's code from here.
      document.addEventListener('scroll', event => {
        const pre = event.target;
        if (pre instanceof Element && pre.matches('.frame[data-cap] pre')) followCode(pre);
      }, true);
      document.addEventListener('click', event => {
        const button = event.target.closest?.('.expressive-code button[data-cap-toggle]');
        if (button) setExpanded(button, button.getAttribute('aria-expanded') !== 'true');
      });
      // An excerpt's range links to #L63-L72: the lines of the complete program that range names are highlighted.
      function arrive(hash) {
        document.querySelectorAll('.ec-line[data-hit]').forEach(row => row.removeAttribute('data-hit'));
        const match = /^#L(\\d+)(?:-L?(\\d+))?$/.exec(hash);
        if (!match) return;
        const first = Number(match[1]);
        const last = Number(match[2] ?? match[1]);
        let target;
        document.querySelectorAll('.frame[data-role="program"]').forEach(frame => frame.querySelectorAll('.ec-line').forEach((row, at) => {
          const number = Number(frame.querySelector(':scope > .rail')?.querySelectorAll('.ln')[at]?.textContent);
          if (number >= first && number <= last) {
            row.setAttribute('data-hit', '');
            target ??= row;
          }
        }));
        if (!target) return;
        // A capped program shows the lines it was sent to.
        const more = target.closest('.frame')?.querySelector('button[data-cap-toggle]');
        if (more && !more.disabled && more.getAttribute('aria-expanded') !== 'true') setExpanded(more, true);
        target.scrollIntoView?.({ block: 'center' });
      }
      const here = () => arrive(location.hash);
      here();
      window.addEventListener('hashchange', here);
      window.addEventListener('popstate', here);
      document.addEventListener('astro:page-load', here);
      // The client router follows a link to a fragment of this page without a hashchange, so the link names where it leads.
      document.addEventListener('click', event => {
        const link = event.target.closest?.('a[href^="#L"]');
        if (link) arrive(link.getAttribute('href'));
      });
    })();`],
    hooks: {
      // A cited range's first row is where a range link lands.
      postprocessRenderedLine: ({ codeBlock, lineIndex, renderData }) => {
        const number = rowsOf(codeBlock)[lineIndex]
        const fragment = number === undefined ? undefined : anchorsOf(codeBlock).get(number)
        if (fragment) renderData.lineAst.properties.id = fragment
      },
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const figure = select('figure.frame', renderData.blockAst)
        const pre = select('pre', renderData.blockAst)
        if (!figure || !pre) return
        const role = codeBlock.metaOptions.getString('role')
        const ranges = parseLines(codeBlock.metaOptions.getString('lines'))

        // A component that draws its own Copy turns the frame's off, so the frame has one.
        if (codeBlock.metaOptions.getString('copy') === 'off') {
          const at = figure.children.indexOf(select('.copy', figure))
          if (at !== -1) figure.children.splice(at, 1)
        }

        const label = roleLabel(role, ranges)
        const header = select('figcaption.header', figure)
        if (label && header && select('.title', header)?.children.length) {
          // Where the page holds the complete program, the range leads to its lines.
          const program = codeBlock.metaOptions.getString('program')
          const detail = !label.detail ? []
            : [' \u00b7 ', program && ranges.length
              ? h('a', { href: `#${rangeFragment(ranges[0])}`, title: `${formatLines([ranges[0]]).replace(/^l/, 'L')} of the complete program ${program}` }, label.detail)
              : label.detail]
          header.children.push(h('span.role', { 'data-pagefind-ignore': '' }, [h('b', label.name), ...detail]))
          figure.properties.dataRole = role
        }

        // A frame whose rows the lines do not describe has no numbers at all; a blank row between ranges has an empty cell.
        const rows = rowsOf(codeBlock)
        if (rows.length) {
          const digits = String(Math.max(...rows.filter((row) => row !== undefined))).length
          figure.properties.style = [figure.properties.style, `--ln-width: ${digits}ch`, `--ln-digits: ${digits}`].filter(Boolean).join(';')
          const rail = h('div.rail', { 'aria-hidden': 'true', 'data-pagefind-ignore': '' }, [
            h('div.rail-in', rows.map((row) => h('span.ln', row === undefined ? [] : [String(row)]))),
          ])
          // Right before the code, so the rail's static position is the code's top edge.
          figure.children.splice(figure.children.indexOf(pre), 0, rail)
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
