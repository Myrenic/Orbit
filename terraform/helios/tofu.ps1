param(
    [Parameter(Mandatory)]
    [ValidateSet("init", "plan", "apply", "destroy")]
    [string]$Command
)

Push-Location $PSScriptRoot

$VarFile = "../infra.json"

try {
    switch ($Command) {
        "init"    { tofu init }
        "plan"    { sops exec-file --filename infra.json $VarFile 'tofu plan -var-file={}' }
        "apply"   { sops exec-file --filename infra.json $VarFile 'tofu apply -var-file={}' }
        "destroy" { sops exec-file --filename infra.json $VarFile 'tofu destroy -var-file={}' }
    }
} finally {
    Pop-Location
}
