

resource "proxmox_virtual_environment_download_file" "talos_nocloud_image" {
  content_type            = "iso"
  datastore_id            = var.proxmox.download_datastore_id
  node_name               = var.proxmox.download_node_name
  file_name               = "talos-${var.talos.version}-nocloud-amd64.img"
  url                     = "https://factory.talos.dev/image/${var.talos.img_id}/${var.talos.version}/nocloud-amd64.raw.gz"
  decompression_algorithm = "gz"
  overwrite               = true
}
