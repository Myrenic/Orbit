variable "hosts" {
  type = map(object({
    name           = string
    cores          = number
    memory         = number
    ip_addr        = string
    gateway        = string
    cidr           = string
    node_name      = string
    network_bridge = string
    datastore_id   = string
    vlan_id        = number
    disk_size      = number
  }))
}

variable "proxmox" {
  type = object({
    url                   = string
    download_node_name    = string
    download_datastore_id = string
    host_description      = string
    host_tags             = list(string)
  })
}

variable "image_id" {
  type = string
}

variable "talos" {
  type = object({
    control_plane_identifier = string
    worker_identifier        = string
  })
}
