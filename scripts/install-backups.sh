#!/usr/bin/env bash
set -euo pipefail
task_repo="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/patex-backup.service" <<EOF
[Unit]
Description=Snapshot Patex projects and accounts
[Service]
Type=oneshot
ExecStart=/bin/bash "$task_repo/scripts/backup.sh"
UMask=0077
EOF
cat > "$HOME/.config/systemd/user/patex-backup.timer" <<'EOF'
[Unit]
Description=Daily Patex backup
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now patex-backup.timer
systemctl --user is-active patex-backup.timer
