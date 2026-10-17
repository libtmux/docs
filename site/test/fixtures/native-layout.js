/**
 * sphinx_ux_autodoc_layout — layout.js
 *
 * Hash-based auto-expansion for both block <details> folds and the
 * custom gp-sphinx-api-signature disclosure wrapper.
 */

(function () {
  'use strict';

  function syncSignatureControls(expandedId, expanded) {
    document
      .querySelectorAll(
        '.gp-sphinx-api-signature-toggle, .gp-sphinx-api-sig-collapse'
      )
      .forEach(function (control) {
        if (control.getAttribute('aria-controls') !== expandedId) return;
        control.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      });
  }

  function setSignatureExpandedById(expandedId, expanded) {
    if (!expandedId) return;

    var expandedPanel = document.getElementById(expandedId);
    if (!expandedPanel) return;

    var signature = expandedPanel.closest('.gp-sphinx-api-signature');
    if (signature) {
      signature.setAttribute('data-expanded', expanded ? 'true' : 'false');
    }

    var header = expandedPanel.closest('.gp-sphinx-api-header');
    if (header) {
      header.setAttribute('data-signature-expanded', expanded ? 'true' : 'false');
    }

    syncSignatureControls(expandedId, expanded);

    if (expanded) {
      expandedPanel.hidden = false;
      expandedPanel.setAttribute('data-expanded', 'true');
      expandedPanel.setAttribute('aria-hidden', 'false');
    } else {
      expandedPanel.hidden = true;
      expandedPanel.setAttribute('data-expanded', 'false');
      expandedPanel.setAttribute('aria-hidden', 'true');
    }
  }

  function setSignatureExpanded(button, expanded) {
    if (!button) return;
    setSignatureExpandedById(button.getAttribute('aria-controls'), expanded);
  }

  function expandAncestors(target) {
    var node = target;
    while (node) {
      if (node.tagName === 'DETAILS' && !node.open) {
        node.open = true;
      }
      node = node.parentElement;
    }
  }

  function expandSignatureForTarget(target) {
    var header = null;

    if (target.classList && target.classList.contains('gp-sphinx-api-header')) {
      header = target;
    } else if (target.closest) {
      header = target.closest('.gp-sphinx-api-header');
    }

    if (!header) return;

    // The managed header carries both desktop and mobile layout variants
    // side-by-side; only one is visible at a time per container query.
    // Expand every panel we find so whichever variant the cascade picks
    // displays in its open state without a flash of collapsed content.
    var expandedPanels = header.querySelectorAll('.gp-sphinx-api-signature-expanded');
    expandedPanels.forEach(function (panel) {
      if (!panel.id) return;
      setSignatureExpandedById(panel.id, true);
    });
  }

  function expandForHash() {
    var hash = window.location.hash;
    if (!hash) return;

    var id = hash.slice(1);
    var target = document.getElementById(id);
    if (!target) return;

    expandAncestors(target);
    expandSignatureForTarget(target);

    setTimeout(function () {
      // No block option: respect CSS scroll-margin-top from the theme.
      target.scrollIntoView();
    }, 50);
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest(
      '.gp-sphinx-api-signature-toggle, .gp-sphinx-api-sig-collapse'
    );
    if (!button) return;

    event.preventDefault();
    var expanded = button.getAttribute('aria-expanded') === 'true';
    setSignatureExpanded(button, !expanded);
  });

  document.addEventListener('DOMContentLoaded', expandForHash);
  window.addEventListener('hashchange', expandForHash);
  document.addEventListener('gp-sphinx:navigated', expandForHash);
})();
