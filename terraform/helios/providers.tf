terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
    }
    talos = {
      source  = "siderolabs/talos"
    }
  }
}

provider "proxmox" {
  endpoint = var.proxmox.url
  username = var.proxmox.username
  password = var.proxmox.password
  insecure = true
}