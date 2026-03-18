param(
    [Parameter(Mandatory)]
    [ValidateSet("helios")]
    [string]$Stack,

    [Parameter(Mandatory)]
    [ValidateSet("init", "plan", "apply", "destroy")]
    [string]$Command
)

switch ($Stack) {
    "helios" { & "$PSScriptRoot/helios/tofu.ps1" -Command $Command }
}
