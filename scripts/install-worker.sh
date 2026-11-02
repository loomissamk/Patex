#!/usr/bin/env bash
set -euo pipefail
task_image="${1:-patex-runner}"
task_root="${PATEX_WORKER_HOME:-$HOME/.local/share/patex-worker}"
task_digest="$(docker image inspect --format '{{.Id}}' "$task_image")"
mkdir -p "$task_root" "$HOME/.config/systemd/user"
chmod 700 "$task_root"
# Extract the matching Node binary and broker from the already built image.
docker run --rm --entrypoint cat "$task_image" /usr/local/bin/node > "$task_root/node"
docker run --rm --entrypoint cat "$task_image" /app/dist/node/compiler/broker.js > "$task_root/broker.mjs"
chmod 700 "$task_root/node"
"$task_root/node" --version
cat > "$HOME/.config/systemd/user/patex-worker.service" <<EOF
[Unit]
Description=Patex isolated document worker
After=default.target

[Service]
Type=simple
Environment=PATEX_RUNNER_IMAGE=$task_digest
Environment=PATEX_WORKER_SOCKET=$task_root/socket/worker.sock
ExecStart="$task_root/node" "$task_root/broker.mjs"
Restart=on-failure
RestartSec=2
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
EOF
mkdir -p "$task_root/socket"
systemctl --user daemon-reload
systemctl --user enable --now patex-worker
systemctl --user restart patex-worker
systemctl --user is-active patex-worker
printf 'Set PATEX_WORKER_DIR=%s/socket in the Patex .env file.\n' "$task_root"
