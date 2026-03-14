module "image" {
  source  = "./modules/image"
  proxmox = var.proxmox
  talos   = var.talos
}

module "vm" {
  source = "./modules/vm"
  hosts  = var.hosts
  proxmox = var.proxmox
  image_id = module.image.image_id
  talos = var.talos
}

module "talos" {
  source = "./modules/talos"
  hosts  = var.hosts
  talos  = var.talos
  control_plane_ips = module.vm.control_plane_ips
  worker_ips        = module.vm.worker_ips
  depends_on        = [module.vm]
}