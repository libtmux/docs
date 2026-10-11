import { select } from 'astro-expressive-code/hast'

/** Keep Copy disabled while the shared Expressive Code script loads. */
export function copyReadiness() {
  return {
    name: 'copy-readiness',
    // Preserve the frame's hover/focus visibility while waiting for handlers.
    // A disabled opacity override flashes the button on every cold load.
    baseStyles: '.copy button:disabled { cursor: progress; } .copy button { transition: none; }',
    // Custom modules follow the built-in frame module in the same bundle.
    // Its observer also attaches handlers before this observer enables buttons.
    jsModules: [`(() => {
      function enable(root) {
        root.querySelectorAll?.('.expressive-code .copy button[data-copy-pending]').forEach(button => {
          button.disabled = false;
          button.removeAttribute('data-copy-pending');
        });
      }
      enable(document);
      new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(enable));
      }).observe(document.body, { childList: true, subtree: true });
      document.addEventListener('astro:page-load', () => enable(document));
    })();`],
    hooks: {
      postprocessRenderedBlock: ({ renderData }) => {
        const button = select('.copy button[data-code]', renderData.blockAst)
        if (!button) return
        button.properties.disabled = true
        button.properties.dataCopyPending = ''
      },
    },
  }
}
