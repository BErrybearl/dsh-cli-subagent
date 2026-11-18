param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
if ($cfg.Env) {
    foreach ($item in $cfg.Env.PSObject.Properties) {
        Set-Item -Path "Env:$($item.Name)" -Value ([string]$item.Value)
    }
}
$startParams = @{
    FilePath = $cfg.File
    RedirectStandardInput = $cfg.Stdin
    RedirectStandardOutput = $cfg.Stdout
    RedirectStandardError = $cfg.Stderr
    WindowStyle = 'Hidden'
    PassThru = $true
}
if ($cfg.Arguments) { $startParams.ArgumentList = $cfg.Arguments } else { $startParams.ArgumentList = '' }
# -Wait is required: without it Start-Process often leaves $p.ExitCode null,
# and the old code turned null into exit 0 (reporting a failed CLI run as success).
$p = Start-Process @startParams -Wait
$code = $p.ExitCode
# Unknown exit code must never be reported as success. 125 = EXIT_CODE_UNKNOWN sentinel.
if ($null -eq $code) { exit 125 }
exit $code
