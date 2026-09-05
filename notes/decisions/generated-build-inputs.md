# Generated build inputs live in the port worktrees, ignored not deleted

Three ports feed this site from files another toolchain generates, written into
the port's `-docs` worktree rather than into this repo:

| port | directory | produced by |
|---|---|---|
| cxx | `libtmux-cxx-docs/xml/` | Doxygen |
| swift | `libtmux-swift-docs/symbolgraph/` | `swift build -emit-symbol-graph` |
| dotnet | `libtmux-dotnet-docs/` DocFX staging | DocFX |

None of them belong in their repository's history — they are outputs, and those
remotes are public. So each is ignored where it sits: C++ through a tracked
`xml/` line in `.gitignore`, Swift through the worktree's own `info/exclude`,
because a `.gitignore` edit would itself be an uncommitted change in a public
repo.

**The failure this prevents.** An untracked directory reads as litter. Deleting
`symbolgraph/` to make `git status` clean removes the Swift reference's only
input, and nothing fails loudly: the extractor finds no graphs, the port yields
no symbols, the build succeeds, and the reference is simply empty. Ignoring
keeps the file and quiets the status line; deleting quietly breaks a port.

**Not to be confused with**: `libtmux-swift/Package.resolved`, which carried a
local modification from 2026-09-03 dropping a Yams pin that `Package.swift`
still declares. That is SwiftPM's own resolution behaviour, it predates any work
here, it is nobody's build input on this side, and the remote is public — so it
was neither committed nor discarded. Stashed under the tag
`libtmux-org-cleanup-20260905-package-resolved`
(`8041c7c612326eaf4faa053b4b48e9b21e84fade`), recoverable with
`git -C ~/work/libtmux/libtmux-swift stash apply <sha>`. The stash stack is
shared across that repository's worktrees, so restore by SHA rather than by
`stash@{n}`, which moves.
