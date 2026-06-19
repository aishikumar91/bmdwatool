#!/usr/bin/env bash
# BMDWATOOL — deploy on Google Cloud Compute Engine (Ubuntu/Debian VM)
#
# First-time VM bootstrap (run as root or with sudo on a fresh GCP instance):
#   curl -fsSL https://raw.githubusercontent.com/aishikumar91/bmdwatool/main/scripts/deploy-gcp-vm.sh | sudo bash -s install
#
# From an existing clone on the VM:
#   sudo ./scripts/deploy-gcp-vm.sh install   # once
#   ./scripts/deploy-gcp-vm.sh deploy         # build + start
#   ./scripts/deploy-gcp-vm.sh update         # pull + rebuild + restart
#   ./scripts/deploy-gcp-vm.sh status
#   ./scripts/deploy-gcp-vm.sh logs [service]
#   ./scripts/deploy-gcp-vm.sh stop
#
# Optional environment variables:
#   REPO_URL=https://github.com/aishikumar91/bmdwatool.git
#   INSTALL_DIR=/opt/bmdwatool
#   GCP_FIREWALL=true          # create gcloud firewall rule (requires gcloud + VM tag bmdwatool)
#   VM_TAG=bmdwatool             # network tag for the firewall rule

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/aishikumar91/bmdwatool.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/bmdwatool}"
GCP_FIREWALL="${GCP_FIREWALL:-true}"
VM_TAG="${VM_TAG:-bmdwatool}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.gcp.yml)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[gcp-deploy]${NC} $*"; }
log_ok() { echo -e "${GREEN}[gcp-deploy]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[gcp-deploy]${NC} $*"; }
log_err() { echo -e "${RED}[gcp-deploy]${NC} $*" >&2; }

require_linux() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    log_err "This script must run on a Linux VM (Google Compute Engine Ubuntu/Debian)."
    exit 1
  fi
}

project_dir() {
  if [[ -f "$(pwd)/docker-compose.yml" ]]; then
    pwd
  elif [[ -f "$INSTALL_DIR/docker-compose.yml" ]]; then
    echo "$INSTALL_DIR"
  else
    log_err "Cannot find docker-compose.yml. Run 'install' first or cd to the repo root."
    exit 1
  fi
}

gcp_external_ip() {
  curl -sf -H "Metadata-Flavor: Google" \
    http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip \
    2>/dev/null || true
}

set_env_var() {
  local key="$1"
  local value="$2"
  local file="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >>"$file"
  fi
}

ensure_env_file() {
  local dir="$1"
  local env_file="$dir/.env"

  if [[ ! -f "$env_file" ]]; then
    if [[ -f "$dir/.env.minimal" ]]; then
      cp "$dir/.env.minimal" "$env_file"
      log_info "Created .env from .env.minimal"
    elif [[ -f "$dir/.env.example" ]]; then
      cp "$dir/.env.example" "$env_file"
      log_info "Created .env from .env.example"
    else
      log_err "No .env, .env.minimal, or .env.example found in $dir"
      exit 1
    fi
  fi

  set_env_var NODE_ENV production "$env_file"
  set_env_var DASHBOARD_ENABLED true "$env_file"
  set_env_var PROXY_ENABLED true "$env_file"
  set_env_var ALLOW_LOGIN_KEY_GENERATION true "$env_file"
  set_env_var AUTO_CLEAR_SESSION_HISTORY true "$env_file"
  set_env_var AUTO_CLEAR_MESSAGE_RETENTION_HOURS 24 "$env_file"
  set_env_var AUTO_CLEAR_INTERVAL_MINUTES 60 "$env_file"
  set_env_var AUTO_CLEAR_AFTER_BROADCAST true "$env_file"
  set_env_var PUPPETEER_HEADLESS true "$env_file"
  set_env_var PUPPETEER_ARGS '--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu' "$env_file"

  local ip
  ip="$(gcp_external_ip)"
  if [[ -n "$ip" ]]; then
    set_env_var DOMAIN "$ip" "$env_file"
    set_env_var DASHBOARD_URL "http://${ip}" "$env_file"
    log_info "Detected GCP external IP: $ip"
  fi
}

compose_profiles() {
  local dir="$1"
  # shellcheck disable=SC1091
  set -a
  source "$dir/.env"
  set +a

  local profiles=(--profile with-dashboard --profile with-proxy)
  if [[ "${DATABASE_TYPE:-sqlite}" == "postgres" && "${POSTGRES_BUILTIN:-false}" == "true" ]]; then
    profiles+=(--profile postgres)
  fi
  if [[ "${REDIS_ENABLED:-false}" == "true" && "${REDIS_BUILTIN:-false}" == "true" ]]; then
    profiles+=(--profile redis)
  fi
  if [[ "${STORAGE_TYPE:-local}" == "s3" && "${MINIO_BUILTIN:-false}" == "true" ]]; then
    profiles+=(--profile minio)
  fi
  echo "${profiles[@]}"
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    log_ok "Docker already installed: $(docker --version)"
    return
  fi

  log_info "Installing Docker..."
  apt-get update -qq
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  local codename
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-$UBUNTU_CODENAME}")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable" \
    >/etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin git
  systemctl enable --now docker
  log_ok "Docker installed"
}

setup_gcp_firewall() {
  [[ "$GCP_FIREWALL" == "true" ]] || return 0
  command -v gcloud >/dev/null 2>&1 || {
    log_warn "gcloud not found — open TCP 80/443 manually in VPC firewall rules"
    return 0
  }

  local rule_name="bmdwatool-http-https"
  if gcloud compute firewall-rules describe "$rule_name" >/dev/null 2>&1; then
    log_ok "Firewall rule '$rule_name' already exists"
    return 0
  fi

  log_info "Creating GCP firewall rule '$rule_name' (ports 80, 443) for tag '$VM_TAG'..."
  gcloud compute firewall-rules create "$rule_name" \
    --direction=INGRESS \
    --priority=1000 \
    --network=default \
    --action=ALLOW \
    --rules=tcp:80,tcp:443 \
    --target-tags="$VM_TAG" \
    --description="BMDWATOOL dashboard + API via Traefik" || log_warn "Could not create firewall rule (may need IAM permissions)"
}

clone_or_update_repo() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log_info "Updating existing clone in $INSTALL_DIR..."
    git -C "$INSTALL_DIR" pull --ff-only
  else
    log_info "Cloning $REPO_URL into $INSTALL_DIR..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
}

cmd_install() {
  require_linux
  [[ "${EUID:-0}" -eq 0 ]] || {
    log_err "Run install with sudo: sudo $0 install"
    exit 1
  }

  apt-get update -qq
  apt-get install -y curl git ca-certificates
  install_docker
  clone_or_update_repo
  ensure_env_file "$INSTALL_DIR"
  setup_gcp_firewall

  local deploy_user="${SUDO_USER:-$USER}"
  if [[ -n "$deploy_user" && "$deploy_user" != "root" ]]; then
    usermod -aG docker "$deploy_user" || true
    log_info "Added user '$deploy_user' to the docker group (log out/in to apply)"
  fi

  log_ok "Install complete."
  log_info "Next: cd $INSTALL_DIR && ./scripts/deploy-gcp-vm.sh deploy"
  log_info "Tag this VM with network tag '$VM_TAG' if you use the gcloud firewall rule."
}

cmd_deploy() {
  require_linux
  local dir
  dir="$(project_dir)"
  cd "$dir"

  ensure_env_file "$dir"
  local profiles
  profiles="$(compose_profiles "$dir")"

  log_info "Building images..."
  # shellcheck disable=SC2086
  "${COMPOSE[@]}" $profiles build

  log_info "Starting BMDWATOOL..."
  # shellcheck disable=SC2086
  "${COMPOSE[@]}" $profiles up -d

  local ip
  ip="$(gcp_external_ip)"
  echo ""
  log_ok "BMDWATOOL is running."
  if [[ -n "$ip" ]]; then
    log_ok "Dashboard: http://${ip}/"
    log_ok "API health: http://${ip}/api/infra/health"
  else
    log_ok "Dashboard: http://<VM-EXTERNAL-IP>/"
  fi
  log_info "View logs: $0 logs"
  log_info "API key file (inside container volume): data/.api-key — use Recover API Key on login"
}

cmd_update() {
  require_linux
  local dir
  dir="$(project_dir)"
  cd "$dir"

  if [[ -d "$dir/.git" ]]; then
    log_info "Pulling latest code..."
    git pull --ff-only
  fi

  cmd_deploy
}

cmd_status() {
  require_linux
  local dir
  dir="$(project_dir)"
  cd "$dir"
  local profiles
  profiles="$(compose_profiles "$dir")"
  # shellcheck disable=SC2086
  "${COMPOSE[@]}" $profiles ps
}

cmd_logs() {
  require_linux
  local dir
  dir="$(project_dir)"
  cd "$dir"
  local service="${1:-openwa-api}"
  local profiles
  profiles="$(compose_profiles "$dir")"
  # shellcheck disable=SC2086
  "${COMPOSE[@]}" $profiles logs -f --tail=100 "$service"
}

cmd_stop() {
  require_linux
  local dir
  dir="$(project_dir)"
  cd "$dir"
  log_info "Stopping all BMDWATOOL containers..."
  docker compose --profile postgres --profile redis --profile minio --profile with-dashboard --profile with-proxy down
  log_ok "Stopped"
}

cmd_help() {
  cat <<EOF

BMDWATOOL — Google Cloud VM deployment

Usage: $0 <command>

Commands:
  install   One-time VM setup (Docker, clone repo, firewall rule, .env)
  deploy    Build and start containers (Traefik on port 80)
  update    git pull + deploy
  status    Show container status
  logs      Tail logs (default service: openwa-api)
  stop      Stop all containers
  help      Show this help

Environment:
  REPO_URL=$REPO_URL
  INSTALL_DIR=$INSTALL_DIR
  GCP_FIREWALL=$GCP_FIREWALL
  VM_TAG=$VM_TAG

EOF
}

main() {
  case "${1:-help}" in
    install) cmd_install ;;
    deploy) cmd_deploy ;;
    update) cmd_update ;;
    status) cmd_status ;;
    logs) cmd_logs "${2:-}" ;;
    stop) cmd_stop ;;
    help | --help | -h) cmd_help ;;
    *)
      log_err "Unknown command: ${1:-}"
      cmd_help
      exit 1
      ;;
  esac
}

main "$@"
