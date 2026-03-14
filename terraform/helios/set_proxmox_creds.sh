# Check if script is sourced
(return 0 2>/dev/null) || {
  echo "Please run this script with 'source $0' or '. $0' to keep environment variables."
  exit 1
}

read -p "Enter Proxmox username (default: root@pam): " username
username=${username:-root@pam}
export PROXMOX_VE_USERNAME="$username"

read -s -p "Enter Proxmox password: " password
export PROXMOX_VE_PASSWORD="$password"