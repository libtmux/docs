(
  set -eu
  mkdir -p /tmp/libtmux-rs-dev
  directory=$(mktemp -d /tmp/libtmux-rs-dev/mixed.XXXXXX)
  socket="$directory/socket"
  cleanup() {
    tmux -S "$socket" kill-server >/dev/null 2>&1 || return
    attempts=0
    while tmux -N -S "$socket" list-sessions >/dev/null 2>&1; do
      attempts=$((attempts + 1))
      [ "$attempts" -lt 100 ] || return 1
      sleep 0.01
    done
    rm -f "$socket"
    rmdir "$directory"
  }
  trap cleanup EXIT
  tmux -S "$socket" -f /dev/null new-session -d -s fixture
  cargo run --quiet -- "$socket"
  [ "$(tmux -S "$socket" list-sessions -F '#{session_name}')" = fixture ]
)
