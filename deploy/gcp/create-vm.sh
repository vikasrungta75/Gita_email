#!/usr/bin/env bash
# Creates the Gita Mail server on Google Cloud: one VM (Ubuntu 24.04) with a fixed IP address,
# a firewall for web traffic, and a Cloud Storage bucket for nightly database backups.
# Run it from Google Cloud Shell (https://shell.cloud.google.com) or any computer with gcloud:
#
#   PROJECT=my-gcp-project DOMAIN=mail.gitapress.org ADMIN_EMAIL=you@gitapress.org bash deploy/gcp/create-vm.sh
#
# Optional: REGION (default asia-south1, Mumbai), ZONE (asia-south1-a), MACHINE (e2-small),
#           VM (gitamail), BUCKET (PROJECT-gitamail-backups), REPO_URL, GITHUB_TOKEN (read-only token
#           if the repository is private).
set -euo pipefail
: "${PROJECT:?Set PROJECT to your Google Cloud project ID}"
: "${DOMAIN:?Set DOMAIN, e.g. mail.gitapress.org}"
: "${ADMIN_EMAIL:?Set ADMIN_EMAIL for the first administrator}"
REGION="${REGION:-asia-south1}"
ZONE="${ZONE:-${REGION}-a}"
MACHINE="${MACHINE:-e2-small}"
VM="${VM:-gitamail}"
BUCKET="${BUCKET:-${PROJECT}-gitamail-backups}"
REPO_URL="${REPO_URL:-https://github.com/vikasrungta75/Gita_email.git}"
SA="gitamail-vm@${PROJECT}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT" >/dev/null
echo "==> Enabling Compute Engine and Cloud Storage"
gcloud services enable compute.googleapis.com storage.googleapis.com iap.googleapis.com

echo "==> Service account for the VM (writes backups only)"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create gitamail-vm --display-name "Gita Mail VM"

echo "==> Backup bucket gs://$BUCKET (30-day retention)"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access
cat > /tmp/gitamail-lifecycle.json <<'L'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}
L
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file=/tmp/gitamail-lifecycle.json
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectAdmin >/dev/null

echo "==> Fixed IP address"
gcloud compute addresses describe "$VM-ip" --region "$REGION" >/dev/null 2>&1 || \
  gcloud compute addresses create "$VM-ip" --region "$REGION"
IP=$(gcloud compute addresses describe "$VM-ip" --region "$REGION" --format='value(address)')

echo "==> Firewall: web (80/443) open; SSH only through Google's IAP"
gcloud compute firewall-rules describe gitamail-web >/dev/null 2>&1 || \
  gcloud compute firewall-rules create gitamail-web --allow tcp:80,tcp:443 --target-tags gitamail --description "Gita Mail web"
gcloud compute firewall-rules describe gitamail-iap-ssh >/dev/null 2>&1 || \
  gcloud compute firewall-rules create gitamail-iap-ssh --allow tcp:22 --source-ranges 35.235.240.0/20 --target-tags gitamail --description "SSH via IAP"

echo "==> VM $VM ($MACHINE, Ubuntu 24.04, 30 GB) in $ZONE"
gcloud compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1 || \
  gcloud compute instances create "$VM" --zone "$ZONE" --machine-type "$MACHINE" \
    --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
    --boot-disk-size 30GB --boot-disk-type pd-balanced \
    --address "$IP" --tags gitamail \
    --service-account "$SA" --scopes cloud-platform \
    --metadata enable-oslogin=TRUE

echo "==> Waiting for the VM to start"
sleep 40

echo "==> Installing Gita Mail on the VM (takes about 5 minutes)"
gcloud compute scp --zone "$ZONE" --tunnel-through-iap "$(dirname "$0")/setup-vm.sh" "$VM":/tmp/setup-vm.sh
gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --command \
  "sudo DOMAIN='$DOMAIN' ADMIN_EMAIL='$ADMIN_EMAIL' BACKUP_BUCKET='$BUCKET' REPO_URL='$REPO_URL' GITHUB_TOKEN='${GITHUB_TOKEN:-}' bash /tmp/setup-vm.sh"

cat <<DONE

Gita Mail server created.
  IP address:  $IP
  Next:        point the DNS record for $DOMAIN (A record) to $IP, then run on the VM:
                 gcloud compute ssh $VM --zone $ZONE --tunnel-through-iap
                 sudo certbot --nginx -d $DOMAIN --redirect -m $ADMIN_EMAIL --agree-tos -n
  Open:        https://$DOMAIN  (sign in with $ADMIN_EMAIL and the password printed above)
DONE
