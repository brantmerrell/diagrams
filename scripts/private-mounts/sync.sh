#!/usr/bin/env bash
# Sync one private mount with its cloud folder.
#   usage: sync.sh <name>      e.g. sync.sh cardforge
# Reads ~/.config/diagrams-private-mounts/<name>.env, which sets:
#   REMOTE=cardforge:                         # rclone remote (root = the shared folder)
#   LOCAL="$HOME/cardforge/drive/Tech Architecture"
#   SVG_THEME=dark                            # dark | light | none
#   FORMAT=png                                # png | svg: what the cloud gets
#   PNG_SCALE=2                               # PNG resolution, as a multiple of SVG size
#
# Two passes, and the cloud folder ends up with the same layout as LOCAL:
#   1. rclone bisync syncs everything both ways, except rendered output
#      (foo/<layer>.svg|png, foo.svg|png).
#   2. Raw output only looks right inside the viewer, which applies its theme
#      toggle and diagramSemanticThemes.css on top. bake_svgs.py writes a copy
#      with that theming built in to a cache OUTSIDE the mount. With
#      FORMAT=png it also renders a PNG, because Drive previews SVGs as a
#      blurry low-res raster. `rclone sync` pushes one way to the same paths
#      in the cloud (foo/<layer>.png or .svg). LOCAL keeps only the raw SVGs,
#      exactly as d2 writes them.
# First run (or after changing the filters below): sync.sh <name> --resync
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
name="${1:?usage: sync.sh <name> [--resync]}"; shift
conf="$HOME/.config/diagrams-private-mounts/$name.env"
# shellcheck source=/dev/null
source "$conf"
: "${REMOTE:?REMOTE unset in $conf}" "${LOCAL:?LOCAL unset in $conf}"
theme="${SVG_THEME:-none}"
case "$theme" in dark|light|none) ;; *) echo "SVG_THEME must be dark|light|none, got '$theme'" >&2; exit 2 ;; esac
format="${FORMAT:-png}"
case "$format" in png|svg) ;; *) echo "FORMAT must be png|svg, got '$format'" >&2; exit 2 ;; esac
cache="${XDG_CACHE_HOME:-$HOME/.cache}/diagrams-private-mounts/$name"
mkdir -p "$LOCAL" "$(dirname "$cache")"

# One run at a time per mount (timer, `bun run start` and manual runs can
# overlap). bisync's own lock only covers pass 1, and two concurrent pass-2
# uploads create duplicate same-name files, which Drive allows.
exec 9>"$cache.lock"
flock 9

# Paths of rendered output (d2's raw SVGs locally, our PNG/SVG copies in the
# cloud), as rclone filter patterns rooted at the mount.
raw=() pushed=()
for d2 in "$LOCAL"/*.d2; do
  [[ -e "$d2" ]] || continue
  stem="$(basename "$d2" .d2)"
  raw+=("/$stem/*.svg" "/$stem.svg" "/$stem/*.png" "/$stem.png")
  pushed+=("/$stem/*.$format" "/$stem.$format")
done

# Pass 1: everything except rendered output, both ways.
filters=(--filter "- .~lock*" --filter "- *.swp" --filter "- *~")
for p in "${raw[@]}"; do filters+=(--filter "- $p"); done
rclone bisync "$REMOTE" "$LOCAL" \
  "${filters[@]}" \
  --resilient --recover --max-lock 2m \
  --conflict-resolve newer --conflict-loser num \
  --drive-skip-gdocs \
  "$@"

# Pass 2: themed copies, one way, at the same paths.
[[ "$theme" == none ]] && exit 0
scale=0; [[ "$format" == png ]] && scale="${PNG_SCALE:-2}"
python3 -I "$here/bake_svgs.py" "$LOCAL" "$theme" "$cache" "$scale"
push=()
for p in "${pushed[@]}"; do push+=(--filter "+ $p"); done
push+=(--filter "- **")   # only touch rendered-output paths in the cloud
rclone sync "$cache" "$REMOTE" "${push[@]}" --drive-skip-gdocs
