# ---------------------------------------------------------------------------
# Firebase Hosting site
#
# Creates the Hosting site resource. The actual deployment of the Angular
# build is handled separately via `firebase deploy --only hosting` and is
# outside Terraform's scope (as documented in gcp/docs/pre-requisites.md).
#
# Requires the google-beta provider because google_firebase_hosting_site
# is not yet promoted to the stable provider.
# ---------------------------------------------------------------------------

resource "google_firebase_hosting_site" "web" {
  provider = google-beta
  project  = var.project_id

  # site_id becomes the subdomain: <site_id>.web.app
  site_id = var.project_id
}
