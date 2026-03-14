variable "proxmox" {
  type = object({
    url                   = string
    download_node_name    = string
    download_datastore_id = string
    host_description      = string
    host_tags             = list(string)
  })
}

variable "talos" {
  type = object({
    cluster_name             = string
    version                  = string
    control_plane_identifier = string
    worker_identifier        = string
    img_id                   = string
  })
}
