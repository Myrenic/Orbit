module "image" {
  source     = "./modules/image"
  proxmox    = var.proxmox
  talos      = var.talos
  node_names = toset([for host in var.hosts : host.node_name])
}

module "vm" {
  source    = "./modules/vm"
  hosts     = var.hosts
  proxmox   = var.proxmox
  image_ids = module.image.image_ids
  talos     = var.talos
}

module "talos" {
  source = "./modules/talos"
  hosts  = var.hosts
  talos  = var.talos
  control_plane_ips = module.vm.control_plane_ips
  worker_ips        = module.vm.worker_ips
  depends_on        = [module.vm]
}