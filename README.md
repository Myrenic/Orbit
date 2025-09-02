<div align="center">

![Description](https://i.redd.it/hsj3x9nwmsd71.jpg)

#  Homelab - Orbit 🌕

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
task terraform-apply
```

4. **Import Terraform outputs** for local access:

```bash
task terraform-import
```

5. **Run pre-checks** to verify environment and CLI tools:

```bash
task pre-checks
```

6. **Bootstrap the cluster** (installs CRDs, cert-manager, external-secrets, and ArgoCD):

```bash
task bootstrap
```

7. **Access ArgoCD**:

```bash
task argo-port-fw
```

Then open [http://localhost:8080](http://localhost:8080) and log in using the admin password stored in Bitwarden.

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
</table>

### platform

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
        <td>Syncs secrets from Azure Key Vault into Kubernetes resources.</td>
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
        <td><img width="32" src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/cert-manager.svg"></td>
        <td><a href="https://cert-manager.io/">Cert-Manager</a></td>
        <td>Manages TLS certificates for secure communication within Kubernetes.</td>
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
