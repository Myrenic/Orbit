echo "Importing config files from terraform..."

terraform output -raw kubeconfig > ~/.kube/config
terraform output -raw talosconfig > ~/.talos/config

export KUBECONFIG=~/.kube/config
export TALOSCONFIG=~/.talos/config

# show nodes
kubectl get nodes