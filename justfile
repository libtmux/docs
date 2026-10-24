# Remove ignored build output. .gitignore decides what that is.
# https://just.systems/

# List available commands
default:
    @just --list

# Remove ignored build output such as node_modules; .env, cache and lock stay.
[group: 'clean']
clean:
    #!/usr/bin/env bash
    # Untracked files, .env and .env.* files, the .build-cache/ build cache and
    # the .build.lock file stay. `pnpm run clean` remains the build-aware clean
    # of generated site output, and takes the lock the same way: it refuses
    # while an assembly holds it. git clean inherits the descriptor, so killing
    # this script does not free the lock while files are still going.
    set -euo pipefail
    exec 9>>.build.lock
    flock --nonblock 9 || { printf 'just clean: an assembly holds .build.lock; wait for it to finish.\n' >&2; exit 1; }
    git clean -fdX -e '!.env' -e '!.env.*' -e '!.build-cache/' -e '!.build.lock'

# Preview what clean will delete. It deletes nothing, so it ignores the lock.
[group: 'clean']
clean-dry:
    git clean -ndX -e '!.env' -e '!.env.*' -e '!.build-cache/' -e '!.build.lock'

# Remove ignored and untracked files. .env and .env.* stay.
[group: 'clean']
[confirm("This will delete all untracked and ignored files. Continue?")]
nuke:
    #!/usr/bin/env bash
    # Refuses while an assembly holds .build.lock, as clean does, once the
    # prompt is answered. git clean -x ignores .gitignore and only preserves -e
    # patterns, so .env is named here rather than negated.
    set -euo pipefail
    exec 9>>.build.lock
    flock --nonblock 9 || { printf 'just nuke: an assembly holds .build.lock; wait for it to finish.\n' >&2; exit 1; }
    git clean -fdx -e '.env' -e '.env.*'
