#!/usr/bin/env bash
# Redeploy TRACEWIRE to Azure (resources already created; see CLAUDE.md "Azure").
#
#   backend  -> Azure Container Apps (image built locally with Docker, pushed to ACR;
#               Azure for Students blocks ACR cloud builds)
#   frontend -> Azure Storage static website ($web container); Static Web Apps is not
#               offered in the regions this subscription allows
#
# Usage (from the repo root, logged in with `az login`, Docker running):
#   ./deploy/azure-redeploy.sh            # backend + frontend
#   ./deploy/azure-redeploy.sh backend    # backend only
#   ./deploy/azure-redeploy.sh frontend   # frontend only
#
# Override names with env vars if your resources differ.
set -euo pipefail

RG="${RG:-forkverse-rg}"
ACR="${ACR:-forkverseacrqb1xft}"
APP="${APP:-forkverse-backend}"
SA="${SA:-forkversewebqb1xft}"
TARGET="${1:-all}"

cd "$(dirname "$0")/.."

BACKEND="$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)"
WEB="$(az storage account show -g "$RG" -n "$SA" --query primaryEndpoints.web -o tsv)"
WEB="${WEB%/}"

if [[ "$TARGET" == "all" || "$TARGET" == "backend" ]]; then
  TAG="v$(date +%Y%m%d%H%M%S)"
  IMG="$ACR.azurecr.io/forkverse-backend:$TAG"
  echo "==> backend: building $IMG"
  docker build --platform linux/amd64 -t "$IMG" ./backend
  az acr login -n "$ACR" >/dev/null
  docker push "$IMG"
  echo "==> backend: rolling out $TAG"
  az containerapp update -g "$RG" -n "$APP" --image "$IMG" -o none
  echo "    https://$BACKEND"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "frontend" ]]; then
  echo "==> frontend: building against https://$BACKEND"
  (cd frontend && VITE_API_BASE_URL="https://$BACKEND/api" VITE_WS_URL="wss://$BACKEND/ws" npx vite build --emptyOutDir)
  echo "==> frontend: uploading to $SA/\$web"
  az storage blob upload-batch -d '$web' -s frontend/dist --account-name "$SA" --auth-mode key --overwrite -o none
  echo "    $WEB"
fi

echo "==> done"
