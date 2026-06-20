#!/usr/bin/env bash
# BMDWATOOL — deploy on Google Cloud Compute Engine (Ubuntu/Debian VM)
#
# First-time VM bootstrap (repo must be reachable via git — curl/raw URLs fail on private repos):
#   sudo apt-get update && sudo apt-get install -y git
#   sudo git clone https://github.com/aishikumar91/bmdwatool.git /opt/bmdwatool
#   cd /opt/bmdwatool && sudo bash scripts/deploy-gcp-vm.sh install
#   sudo bash scripts/deploy-gcp-vm.sh deploy
#
# Private repo: use a GitHub PAT (repo scope):
#   export GITHUB_TOKEN=ghp_xxxxxxxx
#   sudo git clone "https://${GITHUB_TOKEN}@github.com/aishikumar91/bmdwatool.git" /opt/bmdwatool
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
  set_env_var WWEBJS_WEB_VERSION 2.3000.1023204257 "$env_file"

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

ensure_swap() {
  if swapon --show | grep -q '/swapfile'; then
    log_ok "Swap already enabled"
    return
  fi
  log_info "Adding 2G swap (recommended for e2-micro / 1GB RAM)..."
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  log_ok "Swap enabled"
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    log_ok "Docker already installed: $(docker --version)"
    return
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  local os_id="${ID:-linux}"
  local codename="${VERSION_CODENAME:-${UBUNTU_CODENAME:-bookworm}}"

  log_info "Installing Docker (${os_id} ${codename})..."

  # Remove a broken list from a prior run (e.g. ubuntu+trixie on Debian GCP images).
  rm -f /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y ca-certificates curl gnupg git

  install_docker_ce() {
    local distro="$1"
    local suite="$2"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${distro}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${distro} ${suite} stable" \
      >/etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  }

  install_docker_distro() {
    if [[ "$os_id" == "ubuntu" ]]; then
      install_docker_ce ubuntu "$codename"
    elif [[ "$os_id" == "debian" ]]; then
      # Docker CE often lags new Debian releases (e.g. trixie) — use bookworm repo.
      local docker_suite="$codename"
      case "$codename" in
        trixie | sid | testing | unstable)
          docker_suite="bookworm"
          log_warn "Debian ${codename}: Docker CE uses bookworm packages"
          ;;
      esac
      install_docker_ce debian "$docker_suite"
    else
      return 1
    fi
  }

  install_docker_distro_packages() {
    log_warn "Docker CE unavailable — installing docker.io from distro repos"
    apt-get install -y docker.io docker-compose-plugin
  }

  if install_docker_distro; then
    log_ok "Docker CE installed"
  elif install_docker_distro_packages; then
    log_ok "docker.io installed"
  else
    log_err "Could not install Docker. Install manually then re-run: $0 deploy"
    exit 1
  fi

  systemctl enable --now docker
  log_ok "Docker ready: $(docker --version)"
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
  ensure_swap
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
  local force_build="${1:-}"

  ensure_env_file "$dir"
  local profiles
  profiles="$(compose_profiles "$dir")"

  export DOCKER_BUILDKIT=1
  export COMPOSE_DOCKER_CLI_BUILD=1

  local api_image
  api_image="$(docker images -q bmdwatool-openwa-api 2>/dev/null || docker images -q "${dir##*/}-openwa-api" 2>/dev/null || true)"

  if [[ "$force_build" == "--build" || -z "$api_image" ]]; then
    log_info "Building images (first build on e2-micro often takes 20–45 min — this is normal)..."
    log_info "Watch progress: docker compose -f docker-compose.yml -f docker-compose.gcp.yml build --progress=plain"
    # shellcheck disable=SC2086
    "${COMPOSE[@]}" $profiles build
  else
    log_ok "Using existing Docker images (skip rebuild). Run: $0 deploy --build to rebuild"
  fi

  log_info "Starting BMDWATOOL..."
  # shellcheck disable=SC2086
  "${COMPOSE[@]}" $profiles up -d

  print_deploy_urls traefik
}

# Lighter stack for 1 GB VMs: API + dashboard only (no Traefik build), ports 2785 + 2886.
cmd_quick() {
  require_linux
  local dir
  dir="$(project_dir)"
  cd "$dir"
  local force_build="${1:-}"

  ensure_env_file "$dir"
  set_env_var BIND_HOST 0.0.0.0 "$dir/.env"
  set_env_var OPENWA_MEM_LIMIT 768m "$dir/.env"
  set_env_var DASHBOARD_ENABLED false "$dir/.env"
  set_env_var PROXY_ENABLED false "$dir/.env"

  export DOCKER_BUILDKIT=1
  export COMPOSE_DOCKER_CLI_BUILD=1

  log_warn "Quick mode: API :2785 + dashboard :2886 (no Traefik). Recommended for e2-micro."

  if [[ "$force_build" == "--build" ]] || ! docker compose -f docker-compose.dev.yml images -q openwa 2>/dev/null | grep -q .; then
    log_info "Building quick stack (first build on 1 GB RAM: ~15–30 min)..."
    docker compose -f docker-compose.dev.yml build --progress=plain
  else
    log_ok "Using cached images (quick). Run: $0 quick --build to rebuild"
  fi

  docker compose -f docker-compose.dev.yml up -d

  print_deploy_urls quick
}

print_deploy_urls() {
  local mode="${1:-traefik}"
  local ip
  ip="$(gcp_external_ip)"
  echo ""
  log_ok "BMDWATOOL is running."
  if [[ "$mode" == "quick" ]]; then
    if [[ -n "$ip" ]]; then
      log_ok "Dashboard: http://${ip}:2886/"
      log_ok "API health: http://${ip}:2785/api/infra/health"
      log_info "Open GCP firewall for TCP 2785 and 2886"
    else
      log_ok "Dashboard: http://<VM-IP>:2886/"
      log_ok "API: http://<VM-IP>:2785/"
    fi
  elif [[ -n "$ip" ]]; then
    log_ok "Dashboard: http://${ip}/"
    log_ok "API health: http://${ip}/api/infra/health"
  else
    log_ok "Dashboard: http://<VM-EXTERNAL-IP>/"
  fi
  log_info "View logs: $0 logs"
  log_info "API key: use Recover API Key on login (data/.api-key in volume)"
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
  deploy    Build and start full stack (Traefik on port 80)
  quick     Faster 1 GB VM setup — API :2785 + dashboard :2886 (skip Traefik)
  update    git pull + deploy
  status    Show container status
  logs      Tail logs (default service: openwa-api)
  stop      Stop all containers
  help      Show this help

Tips:
  First Docker build on e2-micro (1 GB RAM) often takes 20–45 minutes.
  Add --build to force rebuild. Without it, deploy reuses existing images.
  Upgrade VM to e2-medium (4 GB) for much faster builds.

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
    deploy) cmd_deploy "${2:-}" ;;
    quick) cmd_quick "${2:-}" ;;
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
