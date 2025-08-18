#!/usr/bin/env bash

set -e

REPO_NAME="Light_Cycle"
TERRAFORM_SUBDIR="bootstrap/terraform/ENCOM"


determine_repo_path() {
    CURRENT_DIR=$(pwd)
    INSIDE_REPO=false

    if [[ -d "$CURRENT_DIR/.git" ]] && git rev-parse --show-toplevel &>/dev/null; then
        TOPLEVEL=$(git rev-parse --show-toplevel)
        [[ "$TOPLEVEL" == "$CURRENT_DIR" ]] && INSIDE_REPO=true
    fi

    if $INSIDE_REPO; then
        REPO_PATH="$CURRENT_DIR"
    else
        REPO_PATH="$CURRENT_DIR/$REPO_NAME"
        [[ ! -d "$REPO_PATH" ]] && echo "Repo not found in parent folder!" && return 1
    fi

    TERRAFORM_DIR="$REPO_PATH/$TERRAFORM_SUBDIR"
}

# --- Prompt variables ---
prompt_vars() {
    : "${PROXMOX_VE_USERNAME:=}"
    [[ -z "$PROXMOX_VE_USERNAME" ]] && read -rp "Proxmox VE Username [root@pam]: " PROXMOX_VE_USERNAME
    PROXMOX_VE_USERNAME=${PROXMOX_VE_USERNAME:-root@pam}

    : "${PROXMOX_VE_PASSWORD:=}"
    [[ -z "$PROXMOX_VE_PASSWORD" ]] && read -rsp "Proxmox VE Password: " PROXMOX_VE_PASSWORD && echo

    : "${GIT_REPO:=}"
    [[ -z "$GIT_REPO" ]] && read -rp "Git Repository URL [https://github.com/Myrenic/Light_Cycle/]: " GIT_REPO
    GIT_REPO=${GIT_REPO:-https://github.com/Myrenic/Light_Cycle/}

    : "${GIT_BRANCH:=}"
    [[ -z "$GIT_BRANCH" ]] && read -rp "Git Branch [main]: " GIT_BRANCH
    GIT_BRANCH=${GIT_BRANCH:-main}

    : "${GIT_TOKEN:=}"
    [[ -z "$GIT_TOKEN" ]] && read -rp "Git Token: " GIT_TOKEN
    [[ -z "$GIT_TOKEN" ]] && { echo "Git token is required."; return 1; }

    export PROXMOX_VE_USERNAME PROXMOX_VE_PASSWORD GIT_REPO GIT_BRANCH GIT_TOKEN
}

# --- Install ---
install() {
    echo "Running install..."
    determine_repo_path || return 1
    prompt_vars || return 1

    # Clone if needed
    if [[ ! -d "$REPO_PATH/.git" ]]; then
        git clone -b "$GIT_BRANCH" "$GIT_REPO" "$REPO_PATH" || { echo "Failed to clone repo"; return 1; }
    fi

    terraform -chdir="$TERRAFORM_DIR" init
    terraform -chdir="$TERRAFORM_DIR" apply -auto-approve

    mkdir -p ~/.kube ~/.talos
    terraform -chdir="$TERRAFORM_DIR" output -raw kubeconfig > ~/.kube/config
    terraform -chdir="$TERRAFORM_DIR" output -raw talosconfig > ~/.talos/config

    export KUBECONFIG=~/.kube/config
    export TALOSCONFIG=~/.talos/config

    echo "Created nodes:"
    kubectl get nodes

    export SOPS_AGE_KEY_FILE=~/secrets/age.agekey
    sops -d "$REPO_PATH/apps/traefik/base/cloudflare-api-token.yaml" > "$REPO_PATH/apps/traefik/base/secret.yaml"
    kubectl create ns traefik || true
    kubectl apply -f "$REPO_PATH/apps/traefik/base/secret.yaml"
    argocd-autopilot repo bootstrap --recover
}

# --- Uninstall ---
uninstall() {
    echo "Running uninstall..."
    determine_repo_path || return 1
    prompt_vars || return 1

    terraform -chdir="$TERRAFORM_DIR" destroy -auto-approve
}


# --- List resources ---
list_resources() {
    determine_repo_path || return 1
    echo "Listing Terraform resources..."
    terraform -chdir="$TERRAFORM_DIR" show
    echo "Kubernetes nodes:"
    kubectl get nodes || true
}

run_server() {
    kubectl port-forward -n argocd svc/argocd-server 8080:80 --address 0.0.0.0.0
}

rebuild () {
    uninstall
    install
    run_server
}

# --- Menu ---
menu() {
    while true; do
        echo "Select an action:"
        echo "i) Install"
        echo "u) Uninstall"
        echo "r) rebuild"
        echo "3) List resources"
        echo "4) Run Server"
        echo "5) Exit"
        read -rp "Choice: " choice
        case $choice in
            i) install ;;
            u) uninstall ;;
            r) rebuild ;;
            3) list_resources ;;
            4) run_server ;;
            5) exit 0 ;;
            *) echo "Invalid choice." ;;
        esac
    done
}



# --- Main ---
if [[ -z "$1" ]]; then
    menu
else
    case $1 in
        install) install ;;
        uninstall) uninstall ;;
        list) list_resources ;;
        *) echo "Unknown action: $1" ;;
    esac
fi
