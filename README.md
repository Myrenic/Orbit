## ⚠️⚠️⚠️ Outdated doc, will be updated soon ⚠️⚠️⚠️
<div align="center">

<img src="https://raw.githubusercontent.com/Myrenic/Orbit/refs/heads/main/docs/branding/logo-transparant-bg.png?raw=true" alt="Orbit Logo" width="240"/>

#  Homelab - Orbit 

[![Terraform](https://img.shields.io/badge/Terraform-%235835CC.svg?logo=terraform&logoColor=white)](https://www.terraform.io/)
[![Ansible](https://img.shields.io/badge/Ansible-%231A1918.svg?logo=ansible&logoColor=white)](https://www.ansible.com/)
[![Talos](https://img.shields.io/badge/Talos-blue?logo=kubernetes&logoColor=white)](https://www.talos.dev/)
[![ArgoCD](https://img.shields.io/badge/ArgoCD-orange?logo=argo&logoColor=white)](https://argo-cd.readthedocs.io/)
[![Renovate](https://img.shields.io/badge/Renovate-enabled-brightgreen?logo=renovatebot)](https://github.com/renovatebot/renovate)
![Commits](https://img.shields.io/badge/commits-lost--count-blueviolet)
![Status](https://img.shields.io/badge/status-stable-green)

Repository for managing a [Kubernetes](https://kubernetes.io/) cluster through [GitOps](https://en.wikipedia.org/wiki/DevOps) workflows.

Powered by [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment), [Ansible](https://www.ansible.com/), [Terraform](https://www.terraform.io/), [Talos](https://talos.dev), [Argo CD](https://argoproj.github.io/cd/), and [Task](https://taskfile.dev/).
Kept up to date with [Renovate](https://www.mend.io/renovate/).
Includes a healthy dose of automation and the occasional 3-letter commit message.

</div>

---

## 📖 Overview

This repository hosts the IaC ([Infrastructure as Code](https://en.wikipedia.org/wiki/Infrastructure_as_code)) configuration for my homelab.

The homelab runs on [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment) hypervisor nodes, with VMs provisioned using [Terraform](https://www.terraform.io/) and [Ansible](https://www.ansible.com/).

Most services run on [Talos](https://www.talos.dev/), while a dedicated VM provides an [NFS](https://en.wikipedia.org/wiki/Network_File_System)-based file server for [Longhorn](https://longhorn.io/) backups and media storage.

## 🚀 Getting Started

1. **Set required environment variables**:

```bash
export BW_ORGANIZATION_ID=...
export BW_PROJECT_ID=...
export BW_TOKEN=...
export GIT_TOKEN=...
```

2. **Create Terraform variables** in both `infrastructure/helios` and `infrastructure/atlas` folders.

3. **Deploy the machines** using Terraform:

```bash
task build
```

3. **Bootstrap the cluster** (installs CRDs, cert-manager, external-secrets, and ArgoCD):

```bash
task bootstrap
```

Then open [https://argocd.{{domain}}](https://argocd.{{domain}}) and log in using the admin password stored in Bitwarden.

99. **Full reset**:

Redeploying the cluster is straightforward:

```bash
task reset-infra
```

## Apps

### Services

End-user facing applications

<table>
    <tr>
        <th>Logo</th>
        <th>Name</th>
        <th>Description</th>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/bytestash.svg"></td>
        <td><a href="https://github.com/crccheck/docker-hello-world">Hello-World</a></td>
        <td>Example and template application for the repository</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/frigate.svg"></td>
        <td><a href="https://github.com/blakeblackshear/frigate">Frigate</a></td>
        <td>NVR with real-time object detection for IP cameras</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/jellyseerr.svg"></td>
        <td><a href="https://github.com/Fallenbagel/jellyseerr">Jellyseerr</a></td>
        <td>Media request management and discovery tool for Jellyfin.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/prowlarr.svg"></td>
        <td><a href="https://github.com/Prowlarr/Prowlarr">Prowlarr</a></td>
        <td>Indexer manager for integrating with Sonarr, Radarr, and more.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/radarr.svg"></td>
        <td><a href="https://radarr.video/">Radarr</a></td>
        <td>Movie collection manager for Usenet and BitTorrent users.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://raw.githubusercontent.com/walkxcode/dashboard-icons/master/svg/sonarr.svg"></td>
        <td><a href="https://sonarr.tv/">Sonarr</a></td>
        <td>Smart PVR for TV shows, automating downloads and organization.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://raw.githubusercontent.com/walkxcode/dashboard-icons/master/svg/sabnzbd.svg"></td>
        <td><a href="https://sabnzbd.org/">SABnzbd</a></td>
        <td>Usenet binary newsreader for automated downloads.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://avatars.githubusercontent.com/u/38107502?s=48&v=4"></td>
        <td><a href="https://github.com/Myrenic/RoomctrlScraper">RoomCtrlScraper</a></td>
        <td>Custom service to scrape and manage room control data.</td>
    </tr>
</table>

### Platform

Foundation components for running and deploying applications in my cluster

<table>
    <tr>
        <th>Logo</th>
        <th>Name</th>
        <th>Description</th>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/cert-manager.svg"></td>
        <td><a href="https://cert-manager.io/">Cert Manager</a></td>
        <td>Manages TLS certificates for secure communication within Kubernetes.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://external-secrets.io/latest/pictures/eso-round-logo.svg"></td>
        <td><a href="https://external-secrets.io/latest/">External Secrets</a></td>
        <td>Syncs secrets from external stores into Kubernetes resources.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://argo-cd.readthedocs.io/en/stable/assets/logo.png"></td>
        <td><a href="https://argo-cd.readthedocs.io/en/stable/">Argo CD</a></td>
        <td>GitOps tool for continuous delivery and Kubernetes application management.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://www.svgrepo.com/download/374041/renovate.svg"></td>
        <td><a href="https://github.com/renovatebot/renovate">Renovate</a></td>
        <td>Automates dependency and container image updates via pull requests.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://avatars.githubusercontent.com/u/38107502?s=48&v=4"></td>
        <td>CRDs</td>
        <td>Custom Resource Definitions required by various operators and apps.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://avatars.githubusercontent.com/u/38107502?s=48&v=4"></td>
        <td>Defaults</td>
        <td>Cluster-wide default namespaces and ArgoCD projects.</td>
    </tr>
</table>

### Core

Essential infrastructure services powering the cluster

<table>
    <tr>
        <th>Logo</th>
        <th>Name</th>
        <th>Description</th>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/authentik.svg"></td>
        <td><a href="https://goauthentik.io/">authentik</a></td>
        <td>Identity provider enabling single sign-on (SSO) and centralized user management.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/crowdsec.svg"></td>
        <td><a href="https://www.crowdsec.net/">crowdsec</a></td>
        <td>Collaborative, open-source intrusion prevention and detection system.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://artifacthub.io/static/media/placeholder_pkg_helm.png"></td>
        <td><a href="https://github.com/kubernetes-csi/csi-driver-nfs">csi-driver-nfs</a></td>
        <td>Kubernetes CSI driver for NFS persistent volumes.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/longhorn.svg"></td>
        <td><a href="https://longhorn.io/">longhorn</a></td>
        <td>Cloud-native distributed block storage for Kubernetes.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/metallb.svg"></td>
        <td><a href="https://metallb.universe.tf/">metallb</a></td>
        <td>Load-balancer implementation for bare metal Kubernetes clusters.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://avatars.githubusercontent.com/u/33608853?s=48&v=4"></td>
        <td><a href="https://github.com/emberstack/kubernetes-reflector">reflector</a></td>
        <td>Mirrors Kubernetes secrets and configmaps across namespaces.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/traefik.svg"></td>
        <td><a href="https://traefik.io/">traefik</a></td>
        <td>Cloud-native reverse proxy and ingress controller for Kubernetes.</td>
    </tr>
</table>

## 💻 Hardware

| Name    | Device                 | CPU               | RAM             | Storage          | Purpose           |
|---------|------------------------|-----------------|----------------|-----------------|------------------|
| pve1 | Aoostar R7             | AMD Ryzen 7 5825U | 48 GB DDR4 SO-DIMM | 8TB HDD + 2TB SSD           | Compute/General   |
