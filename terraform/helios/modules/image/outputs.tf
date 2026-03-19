output "image_ids" {
  value = { for node, img in proxmox_virtual_environment_download_file.talos_nocloud_image : node => img.id }
}
