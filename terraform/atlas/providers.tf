terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
    }
    ansible = {
      source  = "ansible/ansible"
    }
  }
}

provider "proxmox" {
  endpoint = var.proxmox.url
  insecure = true
}