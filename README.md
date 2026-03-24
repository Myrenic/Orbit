<div align="center">

<img src="https://raw.githubusercontent.com/Myrenic/Orbit/refs/heads/main/docs/branding/logo-transparant-bg.png?raw=true" alt="Orbit Logo" width="240"/>

#  Homelab - Orbit 

[![Terraform](https://img.shields.io/badge/Terraform-%235835CC.svg?logo=terraform&logoColor=white)](https://www.terraform.io/)
[![Talos](https://img.shields.io/badge/Talos-blue?logo=kubernetes&logoColor=white)](https://www.talos.dev/)
[![ArgoCD](https://img.shields.io/badge/ArgoCD-orange?logo=argo&logoColor=white)](https://argo-cd.readthedocs.io/)
[![Sealed Secrets](https://img.shields.io/badge/Sealed%20Secrets-purple?logo=kubernetes&logoColor=white)](https://github.com/bitnami-labs/sealed-secrets)
[![Renovate](https://img.shields.io/badge/Renovate-enabled-brightgreen?logo=renovatebot)](https://github.com/renovatebot/renovate)
![Commits](https://img.shields.io/badge/commits-lost--count-blueviolet)
![Status](https://img.shields.io/badge/status-stable-green)

Repository for managing a [Kubernetes](https://kubernetes.io/) cluster through [GitOps](https://en.wikipedia.org/wiki/DevOps) workflows.

Powered by [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment), [Terraform](https://www.terraform.io/), [Talos](https://talos.dev), [Argo CD](https://argoproj.github.io/cd/), and [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets).
Kept up to date with [Renovate](https://www.mend.io/renovate/).
Includes a healthy dose of automation and the occasional 3-letter commit message.

</div>

---

## 📖 Overview

This repository hosts the IaC ([Infrastructure as Code](https://en.wikipedia.org/wiki/Infrastructure_as_code)) configuration for my homelab.

The homelab runs on [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment) hypervisor nodes, with VMs provisioned using [Terraform](https://www.terraform.io/).

- **helios** — a [Talos](https://www.talos.dev/) Kubernetes cluster (control plane + workers)
- **atlas** — an Ubuntu VM used as a file server for media storage and [Longhorn](https://longhorn.io/) backups

All cluster workloads are managed via [GitOps](https://en.wikipedia.org/wiki/DevOps) with [Argo CD](https://argoproj.github.io/cd/) and an ApplicationSet that auto-syncs from this repository. Secrets are encrypted in-repo using [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets).

## 🚀 Getting Started

1. **Create Terraform variables** in `terraform/helios` (and optionally `terraform/atlas`). Use the provided `.example` files as a reference.

2. **Deploy the Talos cluster** using Terraform:

```bash
cd terraform/helios
terraform init
terraform apply
```

3. **Bootstrap the cluster** (creates namespaces, restores sealed-secret keys, installs ArgoCD and ArgoCD-Apps):

```powershell
.\scripts\new-Cluster.ps1
```

ArgoCD will automatically sync all remaining applications from the repository. Retrieve the initial admin password with:

```powershell
.\scripts\get-ArgoPassword.ps1
```

4. **Creating a new Sealed Secret**:

```powershell
.\scripts\new-SealedSecret.ps1 -password <value> -namespace <ns> -secretName <name>
```

5. **Backing up Sealed Secret keys**:

```powershell
.\scripts\backup-SealedSecret.ps1
```

6. **Configure Velero Azure credentials** (create a `velero-credentials` secret with a `cloud` key in the `velero` namespace and update `kubernetes/velero/velero/values.yaml` with your Azure storage details).

7. **Restore Velero backups during onboarding (optional)**:

```powershell
.\scripts\new-Cluster.ps1 -RestoreVelero -VeleroSchedule daily
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
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/home-assistant.svg"></td>
        <td><a href="https://www.home-assistant.io/">Home Assistant</a></td>
        <td>Open-source home automation platform (proxied via nginx).</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/memos.svg"></td>
        <td><a href="https://github.com/usememos/memos">Memos</a></td>
        <td>Lightweight, self-hosted note-taking service.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/stremio.svg"></td>
        <td><a href="https://github.com/viren070/aiostreams">AIOStreams</a></td>
        <td>All-in-one Stremio addon aggregator and proxy.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/nexus.svg"></td>
        <td><a href="https://www.sonatype.com/products/sonatype-nexus-repository">Nexus3</a></td>
        <td>Universal artifact repository manager.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/obsidian.svg"></td>
        <td><a href="https://obsidian.md/">Obsidian Sync</a></td>
        <td>Self-hosted sync backend for Obsidian (proxied via nginx).</td>
    </tr>
    <tr>
        <td><img width="32" src="https://avatars.githubusercontent.com/u/38107502?s=48&v=4"></td>
        <td><a href="https://github.com/Myrenic/RoomctrlScraper">RoomCtrlScraper</a></td>
        <td>Custom service to scrape and manage room control data.</td>
    </tr>
</table>

### Network

Ingress, DNS, and identity services

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
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/cert-manager.svg"></td>
        <td><a href="https://cert-manager.io/">Cert Manager</a></td>
        <td>Manages TLS certificates for secure communication within Kubernetes.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/metallb.svg"></td>
        <td><a href="https://metallb.universe.tf/">MetalLB</a></td>
        <td>Load-balancer implementation for bare metal Kubernetes clusters.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/traefik.svg"></td>
        <td><a href="https://traefik.io/">Traefik</a></td>
        <td>Cloud-native reverse proxy and ingress controller for Kubernetes.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/traefik.svg"></td>
        <td>Traefik CRDs</td>
        <td>Custom Resource Definitions required by Traefik.</td>
    </tr>
</table>

### Storage

Persistent storage services

<table>
    <tr>
        <th>Logo</th>
        <th>Name</th>
        <th>Description</th>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/longhorn.svg"></td>
        <td><a href="https://longhorn.io/">Longhorn</a></td>
        <td>Cloud-native distributed block storage for Kubernetes.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/velero.svg"></td>
        <td><a href="https://velero.io/">Velero</a></td>
        <td>Scheduled backups with retention and Azure off-site storage.</td>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/syncthing.svg"></td>
        <td><a href="https://syncthing.net/">Syncthing</a></td>
        <td>Continuous file synchronization between devices.</td>
    </tr>
</table>

### Secrets

Secret management

<table>
    <tr>
        <th>Logo</th>
        <th>Name</th>
        <th>Description</th>
    </tr>
    <tr>
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/bitnami.svg"></td>
        <td><a href="https://github.com/bitnami-labs/sealed-secrets">Sealed Secrets</a></td>
        <td>Encrypts Kubernetes secrets for safe storage in Git.</td>
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
        <td><img width="32" src="https://avatars.githubusercontent.com/u/17888862?s=48&v=4"></td>
        <td><a href="https://github.com/intel/intel-device-plugins-for-kubernetes">Intel QuickSync</a></td>
        <td>Intel GPU device plugin enabling hardware-accelerated video transcoding in Kubernetes.</td>
    </tr>
</table>

## 💻 Hardware

| Name    | Device                 | CPU               | RAM             | Storage          | Purpose           |
|---------|------------------------|-----------------|----------------|-----------------|------------------|
| pve1 | Aoostar R7             | AMD Ryzen 7 5825U | 48 GB DDR4 SO-DIMM | 8TB HDD + 2TB SSD           | Compute/General   |
