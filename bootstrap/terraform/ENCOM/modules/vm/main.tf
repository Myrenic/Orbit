locals {
  control_plane_ips = [
    for host_key, host in var.hosts :
    host.ip_addr if strcontains(host.name, "${var.talos.control_plane_identifier}")
  ]

  worker_ips = [
    for host_key, host in var.hosts :
    host.ip_addr if strcontains(host.name, "${var.talos.worker_identifier}")
  ]
}

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
  }

  network_device {
    bridge  = each.value.network_bridge
    vlan_id = each.value.vlan_id
  }

  disk {
    datastore_id = each.value.datastore_id
    file_id      = var.image_id
    file_format  = "qcow2"
    interface    = "virtio0"
    size         = each.value.disk_size
    discard      = "on"
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
      ipv6 {
        address = "dhcp"
      }
    }
  }
}
