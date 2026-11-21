# Native options and hooks interface fixture

`artifact.json` replays the original Haddock output from the
[successful exact-source topic](https://github.com/libtmux/libtmux-haskell/actions/runs/44464038843)
at [the selected source](https://github.com/libtmux/libtmux-haskell/commit/6e9968812ef9657104a872fb7c1391689d0efdf1).
Its [master CI](https://github.com/libtmux/libtmux-haskell/actions/runs/44465222416)
also passed. The checks and prepared-docs archives have byte-identical compiled
interfaces. All required source pages match committed bytes.

The profile includes raw named buffers, absolute resizing, native object
directories, option and hook definitions, and scoped scalar settings.
`LibTmux.Options` exports catalogue types defined in the private
`LibTmux.Internal.OptionTable`; that module remains source provenance.
