variable "proxmox" {
  type = object({
    url                   = string
    download_datastore_id = string
    host_description      = string
    host_tags             = list(string)
    username              = string
    password              = string
  })
}

variable "node_names" {
  type        = set(string)
  description = "Set of Proxmox node names to download the Talos image to."
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
