# Subir los 2 secretos que suelen faltar, sin depender del parser de .env
# Uso interactivo (te pide los valores):
#   .\scripts\push-secrets-manual.ps1
#
# O con variables ya cargadas en la sesión:
#   $env:WHATSAPP_ACCESS_TOKEN = "EAA..."
#   $env:NOTIFICASHUB_URL = "https://notificashub--studio-3864746689-59018.us-east4.hosted.app"
#   .\scripts\push-secrets-manual.ps1

$ErrorActionPreference = "Stop"
$Project = if ($env:APPHOSTING_PROJECT_ID) { $env:APPHOSTING_PROJECT_ID } else { "studio-3864746689-59018" }
$Backend = if ($env:APPHOSTING_BACKEND_ID) { $env:APPHOSTING_BACKEND_ID } else { "notificashub" }

function Push-OneSecret {
    param(
        [string]$SecretName,
        [string]$Value
    )
    if ([string]::IsNullOrWhiteSpace($Value)) {
        Write-Host "Omitido $SecretName (valor vacio)" -ForegroundColor Yellow
        return
    }
    Write-Host "-> secrets:set $SecretName ..." -ForegroundColor Cyan
    $Value | firebase apphosting:secrets:set $SecretName --force --data-file - --project $Project
    if ($LASTEXITCODE -ne 0) { throw "secrets:set fallo para $SecretName" }
    Write-Host "-> grantaccess $SecretName -> $Backend" -ForegroundColor Cyan
    firebase apphosting:secrets:grantaccess $SecretName --backend $Backend --project $Project
    if ($LASTEXITCODE -ne 0) { throw "grantaccess fallo para $SecretName" }
    Write-Host "OK $SecretName" -ForegroundColor Green
}

# Token WhatsApp: acepta WHATSAPP_ACCESS_TOKEN o WHATSAPP_TOKEN
$wa = $env:WHATSAPP_ACCESS_TOKEN
if ([string]::IsNullOrWhiteSpace($wa)) { $wa = $env:WHATSAPP_TOKEN }
if ([string]::IsNullOrWhiteSpace($wa)) {
    $wa = Read-Host "Pega WHATSAPP_ACCESS_TOKEN (token EAA... de Meta)"
}

$url = $env:NOTIFICASHUB_URL
if ([string]::IsNullOrWhiteSpace($url)) {
    $url = Read-Host "Pega NOTIFICASHUB_URL (ej. https://notificashub--studio-....hosted.app)"
}

Write-Host "`nProyecto: $Project  Backend: $Backend`n" -ForegroundColor Gray

Push-OneSecret -SecretName "whatsapp-access-token" -Value $wa.Trim()
Push-OneSecret -SecretName "NOTIFICASHUB_URL" -Value $url.Trim()

Write-Host "`nListo. Los otros secretos ya los subiste con npm run secrets:push." -ForegroundColor Green
