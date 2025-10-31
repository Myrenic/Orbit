variable "hosts" {
  type = map(object({
    name    = string
    ip_addr = string
  }))
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

variable "control_plane_ips" {
  type = list(string)
}

variable "worker_ips" {
  type = list(string)
}


variable "talos_depends_on" {
  description = "Dependencies for this module"
  type        = any
  default     = null
}
