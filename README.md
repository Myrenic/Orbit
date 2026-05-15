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

All cluster workloads are managed via [GitOps](https://en.wikipedia.org/wiki/DevOps) with [Argo CD](https://argoproj.github.io/cd/) and an ApplicationSet that auto-syncs from this repository. Secrets are encrypted in-repo with [SOPS](https://github.com/getsops/sops) + age for shared/bootstrap material and selected bootstrap secrets, while [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) handles Kubernetes-native secret workflows for application manifests.

Namespaces also carry Pod Security Admission labels. General-purpose namespaces (`argocd`, `auth`, and `services`) enforce the Kubernetes `baseline` profile and emit `restricted` warnings/audits, while infrastructure namespaces that still need elevated access (`monitoring`, `network`, `storage`, and `velero`) keep permissive enforcement and emit `baseline` warnings/audits so exceptions remain visible without breaking workloads.

## 🚀 Getting Started

1. **Prepare the cluster-ops toolbox**.

   Follow [`docs/operations/cluster-ops-toolbox.md`](docs/operations/cluster-ops-toolbox.md) to install the required CLI tools.
   Once the tools are present, validate the workstation toolchain from the repo root with:

   ```powershell
   .\scripts\initialize-ClusterOps.ps1 -SkipConfigImport
   ```

2. **Create Terraform variables** in `terraform/helios` (and optionally `terraform/atlas`). Use the provided `.example` files as a reference.

3. **Deploy the Talos cluster** using Terraform:

```bash
cd terraform/helios
terraform init
terraform apply
```

4. **Import dedicated kubeconfig and talosconfig files for day-2 work**:

```powershell
.\scripts\initialize-ClusterOps.ps1
```

This writes dedicated config files to `~/.kube/orbit-helios.config` and `~/.talos/orbit-helios.config`, then exports `KUBECONFIG` and `TALOSCONFIG` for the current shell.

5. **Bootstrap the cluster** (creates namespaces, reapplies `sealed-secret-backup.yaml` into the `secrets` namespace, installs ArgoCD and ArgoCD-Apps):

```powershell
.\scripts\new-Cluster.ps1
```

ArgoCD will automatically sync all remaining applications from the repository. Retrieve the initial admin password with:

```powershell
.\scripts\get-ArgoPassword.ps1
```

6. **Creating a sealed value for a specific secret key**:

```powershell
.\scripts\new-SealedSecret.ps1 -password <value> -namespace <ns> -secretName <name> -key <secretKey>
```

7. **Edit a SealedSecret file using your default editor (sops-like flow)**:

```powershell
.\scripts\edit-SealedSecret.ps1 -FilePath <path-to-sealed-secret.yaml>
```

This decrypts the file to a temporary manifest, opens it in `$VISUAL`/`$EDITOR` (falls back to `vi`), and reseals it back to the original file when the editor exits.
The script automatically preserves secret name, namespace, and scope (`strict`, `namespace-wide`, `cluster-wide`) from the existing manifest.

8. **Backing up Sealed Secrets recovery keys from the `secrets` namespace**:

```powershell
.\scripts\backup-SealedSecret.ps1
```

Use `-controllerNamespace <namespace>` if your controller is not running in the repo default `secrets` namespace.

9. **Configure Velero Azure credentials** (create a `velero-credentials` secret with a `cloud` key in the `velero` namespace that includes your Azure subscription ID, then update `kubernetes/velero/velero/values.yaml` with your Azure storage account and resource group).

   The repo keeps this credential as a SOPS-encrypted secret manifest at `kubernetes/velero/velero/velero-credentials.sops.yaml`; prefer updating that file instead of introducing a second secret-management pattern.

10. **Restore Velero backups during onboarding (optional)**:

```powershell
.\scripts\new-Cluster.ps1 -RestoreVelero -VeleroSchedule daily
```

## 🧰 Cluster Ops Toolbox

Use the repo's cluster-ops helpers from a dedicated admin workstation shell:

```powershell
.\scripts\initialize-ClusterOps.ps1
.\scripts\get-ClusterOpsSnapshot.ps1 -IncludeVelero
```

- `initialize-ClusterOps.ps1` validates the CLI toolchain and imports dedicated `kubectl`/`talosctl` configs from the Terraform outputs.
- `get-ClusterOpsSnapshot.ps1` gives a quick day-2 status view for nodes, Argo CD applications, unhealthy pods, and optional Velero resources.
- `backup-SealedSecret.ps1` defaults to the repo's active `secrets` namespace, matching the checked-in Sealed Secrets key backup manifest.
- `docs/operations/cluster-ops-toolbox.md` includes the Grafana access flow for the repo-managed monitoring stack.
- `docs/operations/storage-dr.md` captures the repo's current Longhorn replica policy plus the Velero backup and restore drill workflow.

## 🌐 Networking and access conventions

- Public HTTP exposure should use Traefik `IngressRoute` resources on the `websecure` entrypoint.
- External TLS currently terminates in Traefik via the shared `letsencrypt` ACME resolver; `cert-manager`'s `internal-selfsigned` issuer is reserved for cluster-internal certificates.
- Admin and operator-facing routes should usually attach the shared `network/oauth2-proxy-auth` middleware, with `network/local-only` available for LAN-only surfaces when needed.
- The `helm-charts/generic-service` chart now exposes `ingress.entryPoints`, `ingress.middlewares`, and `ingress.tls` settings so new services can follow the same Traefik and access pattern without copy/paste edits.

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
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/prometheus.svg"></td>
        <td><a href="https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack">kube-prometheus-stack</a></td>
        <td>Cluster monitoring foundation with Prometheus, Alertmanager, Grafana, and Traefik/Velero/Longhorn hooks.</td>
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
