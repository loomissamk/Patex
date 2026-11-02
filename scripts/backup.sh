#!/usr/bin/env bash
set -euo pipefail
umask 077
task_container="${PATEX_CONTAINER:-patex-app}"
task_dir="${1:-$HOME/.local/share/patex-backups}"
mkdir -p "$task_dir"
task_file="$task_dir/patex-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
task_image="$(docker inspect --format '{{.Image}}' "$task_container")"
docker pause "$task_container" >/dev/null
trap 'docker unpause "$task_container" >/dev/null' EXIT
docker run --rm --network none --read-only --user 1000:1000 --cap-drop ALL --volumes-from "$task_container:ro" --entrypoint tar "$task_image" -C /data -czf - . > "$task_file"
docker unpause "$task_container" >/dev/null
trap - EXIT
sha256sum "$task_file" > "$task_file.sha256"
printf '%s\n' "$task_file"
