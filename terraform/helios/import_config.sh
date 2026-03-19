echo "Importing config files from tofu..."

sops exec-file --filename infra.json ../infra.json 'tofu output -var-file={} -raw kubeconfig' > ~/.kube/config
sops exec-file --filename infra.json ../infra.json 'tofu output -var-file={} -raw talosconfig' > ~/.talos/config

export KUBECONFIG=~/.kube/config
export TALOSCONFIG=~/.talos/config

# show nodes
kubectl get nodes