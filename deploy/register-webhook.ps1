$ErrorActionPreference = "Stop"

$workerUrl = (Read-Host "Cloudflare Worker URL").TrimEnd("/")
if (-not $workerUrl.StartsWith("https://")) {
  throw "Worker URL must start with https://."
}

$secureToken = Read-Host "Telegram bot token" -AsSecureString
$secureSecret = Read-Host "Webhook secret (same value stored in Cloudflare)" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)

try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $body = @{
    url = "$workerUrl/telegram"
    secret_token = $secret
    allowed_updates = @("message", "callback_query")
  } | ConvertTo-Json -Compress

  try {
    $result = Invoke-RestMethod `
      -Uri "https://api.telegram.org/bot$token/setWebhook" `
      -Method Post `
      -ContentType "application/json" `
      -Body $body
  } catch {
    throw "Webhook registration failed. Check the token and Worker URL."
  }

  if (-not $result.ok) {
    throw "Telegram rejected the webhook registration."
  }
  Write-Output "Telegram webhook configured."
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  $token = $null
  $secret = $null
}
