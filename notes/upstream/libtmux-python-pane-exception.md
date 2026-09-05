# A Pane exception inherits WindowError, so `except PaneError` misses it

Two problems in `src/libtmux/exc.py`, found while resolving
cross-references across the library. The first changes behaviour.

## 1. `PaneAdjustmentDirectionRequiresAdjustment` is not a `PaneError`

`src/libtmux/exc.py:433`:

```python
class PaneAdjustmentDirectionRequiresAdjustment(
    WindowError,
    AdjustmentDirectionRequiresAdjustment,
):
    """ValueError for :meth:`libtmux.Pane.resize_pane`."""
```

Every other pane exception derives from `PaneError` — `PaneNotFound` at
line 384 is the only sibling and does. This one derives from
`WindowError`, so:

```python
try:
    pane.resize(...)
except exc.PaneError:
    ...        # never reached
except exc.WindowError:
    ...        # catches a pane error
```

`WindowError` at line 394 is directly above `PaneError` at line 380,
which is consistent with a copy of the `Window` class two definitions
up. The fix is presumably `PaneError` in place of `WindowError`, though
that is a public base-class change and yours to weigh.

## 2. `WindowAdjustmentDirectionRequiresAdjustment` documents a method
that does not exist

`src/libtmux/exc.py:430`:

```python
    """ValueError for :meth:`libtmux.Window.resize_window`."""
```

`Window` has no `resize_window`; the method is `resize`
(`src/libtmux/window.py:717`), and `resize_window` appears nowhere else
in the package. The `Pane` docstring below it is correct —
`Pane.resize_pane` does exist at `src/libtmux/pane.py:2830`.

Sphinx renders an unresolved `:meth:` as plain text rather than failing,
so the docstring reads as though it links somewhere and does not.
`nitpicky = True` in `docs/conf.py` surfaces this class of problem at
build time.

---

## Status

Fixed, not filed. Nothing was posted to any public repo.

`tony/libtmux-python` branch `fix/pane-exception-base`:

- `PaneAdjustmentDirectionRequiresAdjustment` now inherits `PaneError`.
- The sibling docstring's `Window.resize_window` corrected to
  `Window.resize`.
- `tests/test_exc.py` added, pinning the hierarchy for both families.
  It fails on two tests without the base-class fix.
- `CHANGES` entry under Bug fixes, flagging the public base-class change.

The base class is public API: code catching this as `WindowError` stops
catching it. Code catching `LibTmuxException` or `ValueError` is
unaffected. Worth saying explicitly in any PR description.
