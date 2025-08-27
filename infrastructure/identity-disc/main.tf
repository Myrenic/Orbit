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

  provisioner "remote-exec" {
    inline = [
      "sudo apt-get update -qq -y",
      "while fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 2; Echo apt update finished;",
      "sudo apt-get install -y -qq nfs-kernel-server nfs-common qemu-guest-agent",
      "while fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 2; Echo apt install finished;",
      "sudo mkfs.ext4 -F /dev/vdb",
      "sudo mkdir -p /mnt/nfs_disk",
      "sudo mount /dev/vdb /mnt/nfs_disk",
      "grep -q '/dev/vdb' /etc/fstab || echo '/dev/vdb /mnt/nfs_disk ext4 defaults 0 2' | sudo tee -a /etc/fstab",
      "for dir in media config backup; do sudo mkdir -p /mnt/nfs_disk/$dir; sudo chown nobody:nogroup /mnt/nfs_disk/$dir; Echo done",
      "for dir in media config backup; do grep -q '/mnt/nfs_disk/$dir' /etc/exports || echo \"/mnt/nfs_disk/$dir 10.0.69.0/24(rw,sync,no_subtree_check,no_root_squash)\" | sudo tee -a /etc/exports; done",
      "sudo systemctl enable --now nfs-server qemu-guest-agent",
      "sudo exportfs -ra"
    ]
  


    connection {
      type        = "ssh"
      host        = each.value.ip_addr
      user        = "ubuntu"
      private_key = file("~/.ssh/mtuntelder_admin")
      password    = random_password.ubuntu_vm_password.result
      timeout     = "5m"
    }
  }
}

output "ubuntu_vm_password" {
  value     = random_password.ubuntu_vm_password.result
  sensitive = true
}
