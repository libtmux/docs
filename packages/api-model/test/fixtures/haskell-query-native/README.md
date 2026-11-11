# Native query interface fixture

These public Haddock pages and the installed interface describe
[`libtmux-haskell` at the recorded revision](https://github.com/libtmux/libtmux-haskell/commit/fb86b60139795746e8964643a4f048fcd8a63d14).
The qualified GHC/Haddock build exposes sixteen modules. Every consumed source
page was checked against committed bytes after excluding generated annotation
tooltips. `provenance.json` identifies the source and module inventory.

The fixture preserves native type parameters, constraints, signatures, field
owners and module links. It includes the generator's default Documentation
sections where a field module has no authored export groups. Private defining
files provide source locations, without becoming public reference modules.

The native source identifier for the `Order` type also names its private
constructor. Its source link retains the defining file; the exporter does not
invent a unique line for that ambiguous target.

The scalar and seven-module observation fixtures remain separate qualification
inputs. This fixture adds the public query interface; it exposes no query AST
constructors or private mutation methods.
