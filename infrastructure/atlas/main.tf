# Download Ubuntu Cloud image
resource "proxmox_virtual_environment_download_file" "nocloud_image" {
  content_type = "iso"
  datastore_id = var.proxmox.download_datastore_id
  node_name    = var.proxmox.download_node_name
  file_name    = "ubuntu-22.04-cloudimg-amd64.img"
  url          = "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img"
  overwrite    = false
}

# Fetch SSH keys from GitHub
data "http" "github_keys" {
  url = "https://github.com/Myrenic.keys"
}

# Generate VM password
resource "random_password" "ubuntu_vm_password" {
  length           = 12
  override_special = "_%@"
  special          = true
}

# VM resource
resource "proxmox_virtual_environment_vm" "vm" {
  for_each    = var.hosts
  name        = each.value.name
  description = var.proxmox.host_description
  tags        = var.proxmox.host_tags
  node_name   = each.value.node_name
  on_boot     = true

  cpu {
    cores = each.value.cores
    type  = "x86-64-v2-AES"
  }

  memory {
    dedicated = each.value.memory
  }

  agent {
    enabled = true
    timeout = "1s"
  }

  network_device {
    bridge  = each.value.network_bridge
    vlan_id = each.value.vlan_id
  }

  disk {
    datastore_id = each.value.datastore_id
    file_id      = proxmox_virtual_environment_download_file.nocloud_image.id
    file_format  = "raw"
    interface    = "virtio0"
    size         = each.value.disk_size
  }

  disk {
    datastore_id = each.value.hdd_datastore_id
    interface    = "virtio1"
    file_format  = "raw"
    size         = each.value.hdd_disk_size
  }

  operating_system {
    type = "l26"
  }

  initialization {
    datastore_id = each.value.datastore_id

    ip_config {
      ipv4 {
        address = "${each.value.ip_addr}${each.value.cidr}"
        gateway = each.value.gateway
      }
    }

    user_account {
      username = "ubuntu"
      password = random_password.ubuntu_vm_password.result
      keys     = split("\n", chomp(data.http.github_keys.response_body))
    }
  }
}

resource "ansible_playbook" "deploy_apps" {
  for_each = proxmox_virtual_environment_vm.vm
  name     = each.value.name
  playbook = "playbook.yaml"

  extra_vars = {
    ansible_host                = split("/", each.value.initialization[0].ip_config[0].ipv4[0].address)[0]
    ansible_user                = "ubuntu"
    ansible_ssh_extra_args      = "-o StrictHostKeyChecking=no -o PreferredAuthentications=password"
  }

  replayable = true
}

output "ubuntu_vm_password" {
  value     = random_password.ubuntu_vm_password.result
  sensitive = true
}
