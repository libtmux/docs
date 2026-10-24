# Remove ignored build output. .gitignore decides what that is.
# https://just.systems/

# List available commands
default:
    @just --list

# Remove ignored build artifacts such as node_modules. Untracked files, .env
# files, the .build-cache/ build cache and the .build.lock file stay.
# `pnpm run clean` remains the build-aware clean of generated site output.
[group: 'clean']
clean:
    git clean -fdX -e '!.env' -e '!.env.*' -e '!.build-cache/' -e '!.build.lock'

# Preview what clean will delete.
[group: 'clean']
clean-dry:
    git clean -ndX -e '!.env' -e '!.env.*' -e '!.build-cache/' -e '!.build.lock'

# Remove ignored and untracked files. .env and .env.* stay.
# git clean -x ignores .gitignore and only preserves -e patterns, so .env is named here rather than negated.
[group: 'clean']
[confirm("This will delete all untracked and ignored files. Continue?")]
nuke:
    git clean -fdx -e '.env' -e '.env.*'
