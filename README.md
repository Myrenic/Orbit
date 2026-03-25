<div align="center">

<img src="https://raw.githubusercontent.com/Myrenic/Orbit/refs/heads/main/docs/branding/logo-transparant-bg.png?raw=true" alt="Orbit Logo" width="240"/>

#  Homelab - Orbit

[![Terraform](https://img.shields.io/badge/Terraform-%235835CC.svg?logo=terraform&logoColor=white)](https://www.terraform.io/)
[![Talos](https://img.shields.io/badge/Talos-blue?logo=kubernetes&logoColor=white)](https://www.talos.dev/)
[![Flux](https://img.shields.io/badge/Flux-blue?logo=flux&logoColor=white)](https://fluxcd.io/)
[![SOPS](https://img.shields.io/badge/SOPS-green?logo=mozilla&logoColor=white)](https://github.com/getsops/sops)
[![Renovate](https://img.shields.io/badge/Renovate-enabled-brightgreen?logo=renovatebot)](https://github.com/renovatebot/renovate)
![Status](https://img.shields.io/badge/status-stable-green)

Repository for managing a [Kubernetes](https://kubernetes.io/) cluster through [GitOps](https://en.wikipedia.org/wiki/DevOps) workflows.

Powered by [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment), [Terraform](https://www.terraform.io/), [Talos](https://talos.dev), [Flux](https://fluxcd.io/), and [SOPS](https://github.com/getsops/sops) with [age](https://github.com/FiloSottile/age) encryption.
Kept up to date with [Renovate](https://www.mend.io/renovate/).

</div>

---

## 📖 Overview

This repository hosts the IaC ([Infrastructure as Code](https://en.wikipedia.org/wiki/Infrastructure_as_code)) configuration for my homelab.

The homelab runs on [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment) hypervisor nodes, with VMs provisioned using [Terraform](https://www.terraform.io/).

- **helios** — a [Talos](https://www.talos.dev/) Kubernetes cluster (control plane + workers)
- **atlas** — an Ubuntu VM used as a file server for media storage and backups

All cluster workloads are managed via [GitOps](https://en.wikipedia.org/wiki/DevOps) with [Flux](https://fluxcd.io/) and Kustomize overlays that auto-sync from this repository. Secrets are encrypted in-repo using [SOPS](https://github.com/getsops/sops) with [age](https://github.com/FiloSottile/age) encryption.

## 📁 Repository Structure

```
├── kubernetes/
│   ├── apps/                    # Application workloads
│   │   ├── hello-world/         # Example application
│   │   │   ├── kustomization.yaml
│   │   │   ├── namespace.yaml
│   │   │   ├── deployment.yaml
│   │   │   ├── service.yaml
│   │   │   └── secret.enc.yaml  # SOPS-encrypted secret
│   │   └── kustomization.yaml   # Top-level app kustomization
│   ├── infrastructure/
│   │   ├── controllers/         # Infrastructure controllers (Helm, etc.)
│   │   │   └── kustomization.yaml
│   │   └── configs/             # Cluster-wide configs
│   │       └── kustomization.yaml
│   └── clusters/
│       └── homelab/             # Cluster-specific Flux Kustomizations
│           ├── apps.yaml        # Points to kubernetes/apps/
│           └── infrastructure.yaml  # Points to kubernetes/infrastructure/
├── terraform/                   # Infrastructure provisioning (Proxmox VMs)
├── scripts/                     # Helper scripts
├── .sops.yaml                   # SOPS encryption rules
└── .github/workflows/           # CI/CD pipelines
```

### How Flux Works

Flux watches the Git repository and reconciles the cluster state:

1. **`clusters/homelab/infrastructure.yaml`** → deploys infrastructure controllers and configs
2. **`clusters/homelab/apps.yaml`** → deploys application workloads (depends on infrastructure)
3. Flux automatically decrypts SOPS-encrypted secrets using the age key stored in-cluster

## 🚀 Getting Started

### Prerequisites

Install these tools:

- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [flux](https://fluxcd.io/flux/installation/) (v2+)
- [sops](https://github.com/getsops/sops/releases) (v3.9+)
- [age](https://github.com/FiloSottile/age/releases) (v1.2+)
- [kustomize](https://kubectl.docs.kubernetes.io/installation/kustomize/) (v5+)

### 1. Generate an age Key (First Time Only)

```bash
# Generate a new age key pair
age-keygen -o age.key

# The output shows your public key, e.g.:
# Public key: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> ⚠️ **Store `age.key` securely!** This is your master decryption key. Never commit it to Git.

### 2. Configure SOPS

Update `.sops.yaml` with your age public key:

```yaml
creation_rules:
  - path_regex: kubernetes/.*\.enc\.yaml$
    encrypted_regex: ^(data|stringData)$
    age: age1your-public-key-here
```

### 3. Deploy Infrastructure with Terraform

```bash
cd terraform/helios
terraform init
terraform apply
```

### 4. Bootstrap the Cluster with Flux

```bash
# Export your GitHub token
export GITHUB_TOKEN=<your-github-pat>

# Bootstrap Flux (this installs Flux and configures it to watch this repo)
flux bootstrap github \
  --owner=myrenic \
  --repository=orbit \
  --branch=main \
  --path=./kubernetes/clusters/homelab \
  --personal

# Create the SOPS age secret so Flux can decrypt secrets
kubectl create secret generic sops-age \
  --namespace=flux-system \
  --from-file=age.agekey=age.key
```

Or use the helper script:

```powershell
.\scripts\new-Cluster.ps1 -AgeKeyFile .\age.key
```

Flux will automatically sync all applications from the repository.

## 🔐 Managing Secrets with SOPS

### Creating a New Secret

1. Create a plain Kubernetes secret YAML:

```yaml
# /tmp/my-secret.yaml (temporary — DO NOT commit this file)
apiVersion: v1
kind: Secret
metadata:
  name: my-app-secret
  namespace: my-app
type: Opaque
stringData:
  api-key: super-secret-value
  database-url: postgres://user:pass@host/db
```

2. Encrypt it with SOPS:

```bash
sops --encrypt /tmp/my-secret.yaml > kubernetes/apps/my-app/secret.enc.yaml
```

SOPS uses the rules from `.sops.yaml` to determine which age key and encryption regex to use. Only the `data` and `stringData` fields are encrypted — metadata stays readable for GitOps diffs.

3. Add the encrypted file to your kustomization:

```yaml
# kubernetes/apps/my-app/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
  - secret.enc.yaml  # SOPS-encrypted secret
```

4. Commit and push — Flux will decrypt and apply it automatically.

### Editing an Existing Secret

```bash
# Decrypt in-place for editing, then re-encrypt on save
sops kubernetes/apps/my-app/secret.enc.yaml
```

This opens the decrypted YAML in your `$EDITOR`. When you save and close, SOPS automatically re-encrypts the file.

### Viewing a Secret (Read-Only)

```bash
sops --decrypt kubernetes/apps/my-app/secret.enc.yaml
```

### SOPS File Naming Convention

All SOPS-encrypted files must end with `.enc.yaml` to match the `.sops.yaml` creation rules.

## 🔑 Age Key Management

### Importing an Age Key

If you have a backup of your age key and need to use it on a new machine:

```bash
# Copy the key file to your machine
cp /path/to/backup/age.key ~/.config/sops/age/keys.txt

# Or set the environment variable
export SOPS_AGE_KEY_FILE=/path/to/age.key

# Verify it works
sops --decrypt kubernetes/apps/hello-world/secret.enc.yaml
```

### Setting Up the Age Key in the Cluster

After every cluster rebuild, you need to provide the age key to Flux:

```bash
kubectl create secret generic sops-age \
  --namespace=flux-system \
  --from-file=age.agekey=/path/to/age.key
```

### Backing Up the Age Key

The age key is the **only key** needed to decrypt all secrets in this repository. Back it up securely:

```bash
# Option 1: Secure file backup
cp age.key /path/to/secure/backup/orbit-age.key
chmod 400 /path/to/secure/backup/orbit-age.key

# Option 2: Print and store in a password manager
cat age.key
# Copy the entire content (including the comment line with the public key)
# and store it in your password manager (e.g., 1Password, Bitwarden)
```

> ⚠️ **If you lose the age key, all encrypted secrets become unrecoverable!**
> Always keep at least two backups in different locations.

### Rotating the Age Key

To rotate your age key (e.g., if compromised):

```bash
# 1. Generate a new key
age-keygen -o new-age.key
NEW_PUB=$(grep "public key" new-age.key | cut -d: -f2 | tr -d ' ')

# 2. Update .sops.yaml with the new public key
sed -i "s|age: age1.*|age: $NEW_PUB|" .sops.yaml

# 3. Re-encrypt all secrets with the new key
find kubernetes/ -name '*.enc.yaml' | while read f; do
  sops --rotate --in-place "$f"
done

# 4. Update the cluster secret
kubectl create secret generic sops-age \
  --namespace=flux-system \
  --from-file=age.agekey=new-age.key \
  --dry-run=client -o yaml | kubectl apply -f -

# 5. Commit and push
git add .
git commit -m "Rotate SOPS age key"
git push
```

## ➕ Adding a New App

### 1. Create the App Directory

```bash
mkdir -p kubernetes/apps/my-new-app
```

### 2. Create the Manifests

```yaml
# kubernetes/apps/my-new-app/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: my-new-app
```

```yaml
# kubernetes/apps/my-new-app/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-new-app
  namespace: my-new-app
  labels:
    app: my-new-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-new-app
  template:
    metadata:
      labels:
        app: my-new-app
    spec:
      containers:
        - name: my-new-app
          image: my-image:latest
          ports:
            - containerPort: 8080
              name: http
```

```yaml
# kubernetes/apps/my-new-app/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: my-new-app
  namespace: my-new-app
spec:
  selector:
    app: my-new-app
  ports:
    - port: 80
      targetPort: http
      name: http
```

```yaml
# kubernetes/apps/my-new-app/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: my-new-app
resources:
  - namespace.yaml
  - deployment.yaml
  - service.yaml
```

### 3. Register the App

Add it to the top-level kustomization:

```yaml
# kubernetes/apps/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - hello-world
  - my-new-app   # Add your new app here
```

### 4. (Optional) Add Secrets

If your app needs secrets, create and encrypt them:

```bash
# Create the plain secret
cat > /tmp/my-new-app-secret.yaml << EOF
apiVersion: v1
kind: Secret
metadata:
  name: my-new-app-secret
  namespace: my-new-app
type: Opaque
stringData:
  api-key: your-secret-value
EOF

# Encrypt it
sops --encrypt /tmp/my-new-app-secret.yaml > kubernetes/apps/my-new-app/secret.enc.yaml

# Clean up the plain file
rm /tmp/my-new-app-secret.yaml

# Add to kustomization.yaml
# resources:
#   - secret.enc.yaml
```

### 5. Commit and Push

```bash
git add kubernetes/apps/my-new-app/ kubernetes/apps/kustomization.yaml
git commit -m "Add my-new-app"
git push
```

Flux will automatically detect the change and deploy the app within the reconciliation interval (default: 10 minutes, or trigger manually with `flux reconcile kustomization apps`).

### Adding a Helm-Based App

For apps deployed via Helm charts, use Flux `HelmRelease` and `HelmRepository` CRDs:

```yaml
# kubernetes/apps/my-helm-app/helmrelease.yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: my-helm-app
  namespace: my-helm-app
spec:
  interval: 30m
  chart:
    spec:
      chart: my-chart
      version: "1.2.3"
      sourceRef:
        kind: HelmRepository
        name: my-repo
        namespace: flux-system
  values:
    key: value
```

```yaml
# kubernetes/infrastructure/controllers/helmrepo.yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: my-repo
  namespace: flux-system
spec:
  interval: 24h
  url: https://charts.example.com
```

## 🧪 CI/CD

The repository includes several GitHub Actions workflows:

| Workflow | Purpose |
|----------|---------|
| **Test Flux Deployment** | Spins up a minikube cluster, installs Flux, deploys all apps, and verifies pods are running and services are reachable |
| **YAML Linter** | Validates YAML syntax across the repository |
| **Kustomize Validation** | Builds and validates all Kustomize overlays |
| **Manifest References** | Ensures all YAML manifests are referenced by a kustomization |
| **Terraform Validation** | Validates Terraform configurations |

## 💻 Hardware

| Name | Device | CPU | RAM | Storage | Purpose |
|------|--------|-----|-----|---------|---------|
| pve1 | Aoostar R7 | AMD Ryzen 7 5825U | 48 GB DDR4 SO-DIMM | 8TB HDD + 2TB SSD | Compute/General |
