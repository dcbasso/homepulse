# ---------------------------------------------------------------------------
# Cloud Storage bucket — function source
#
# Stores the zipped source code for the Cloud Function.
# Not public; access is granted only to the Cloud Functions service agent.
# ---------------------------------------------------------------------------

resource "google_storage_bucket" "function_source" {
  name                        = "${var.project_id}-function-source"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  labels = local.common_labels
}

# ---------------------------------------------------------------------------
# Archive — zip the function source directory
#
# The archive provider reads ../function/ and produces a deterministic zip.
# Changing any file inside function/ triggers a new upload and redeployment.
# ---------------------------------------------------------------------------

data "archive_file" "function_source" {
  type        = "zip"
  source_dir  = "${path.module}/../function"
  output_path = "${path.module}/.terraform/tmp/function-source.zip"
}

# ---------------------------------------------------------------------------
# Cloud Storage object — upload the zip
# ---------------------------------------------------------------------------

resource "google_storage_bucket_object" "function_source" {
  name   = "function-source-${data.archive_file.function_source.output_md5}.zip"
  bucket = google_storage_bucket.function_source.name
  source = data.archive_file.function_source.output_path
}

# ---------------------------------------------------------------------------
# Cloud Function (Gen 2) — check-internet-status
#
# Triggered via HTTP by Cloud Scheduler (see scheduler.tf).
# Reads the three Gmail secrets from Secret Manager at runtime.
# ---------------------------------------------------------------------------

resource "google_cloudfunctions2_function" "check_internet_status" {
  name     = "check-internet-status"
  location = var.region

  labels = local.common_labels

  build_config {
    runtime     = "python312"
    entry_point = "check_internet_status"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    # Memory and timeout are generous for a lightweight HTTP check.
    available_memory   = "256M"
    timeout_seconds    = 60
    min_instance_count = 0
    max_instance_count = 1

    # Plain environment variables (non-sensitive).
    environment_variables = {
      GCP_PROJECT_ID           = var.project_id
      ALERT_EMAIL              = var.alert_email
      MAX_MINUTES_WITHOUT_DATA = tostring(var.max_minutes_without_data)
      FIRESTORE_DATABASE       = var.firestore_database
    }

    # Sensitive values injected from Secret Manager at startup.
    # The secrets must already exist (created in pre-requisites).
    secret_environment_variables {
      key        = "GMAIL_CLIENT_ID"
      project_id = var.project_id
      secret     = data.google_secret_manager_secret.gmail_client_id.secret_id
      version    = "latest"
    }

    secret_environment_variables {
      key        = "GMAIL_CLIENT_SECRET"
      project_id = var.project_id
      secret     = data.google_secret_manager_secret.gmail_client_secret.secret_id
      version    = "latest"
    }

    secret_environment_variables {
      key        = "GMAIL_REFRESH_TOKEN"
      project_id = var.project_id
      secret     = data.google_secret_manager_secret.gmail_refresh_token.secret_id
      version    = "latest"
    }

    service_account_email = var.sa_email
  }
}

# ---------------------------------------------------------------------------
# IAM — allow unauthenticated HTTP invocations
#
# Cloud Scheduler sends an OIDC token, but the invoker binding must also
# allow unauthenticated callers so the function URL is reachable.
# Scheduler enforces auth on its own via the OIDC audience.
# ---------------------------------------------------------------------------

resource "google_cloud_run_service_iam_member" "function_invoker" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.check_internet_status.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Cloud Function (Gen 2) — whoami
#
# Public HTTP endpoint that reports the caller's WAN IP address. Used by the
# Rust client's heartbeat check. Reuses the same source archive as
# check_internet_status (the whole function/ directory is already zipped),
# only the entry point differs. No secrets required.
# ---------------------------------------------------------------------------

resource "google_cloudfunctions2_function" "whoami" {
  name     = "whoami"
  location = var.whoami_region

  labels = local.common_labels

  build_config {
    runtime     = "python312"
    entry_point = "whoami"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    # 256M is the practical floor for Cloud Run's default fractional CPU —
    # 128M (decimal) falls just under the 128Mi (binary) minimum it enforces.
    available_memory   = "256M"
    timeout_seconds    = 10
    min_instance_count = 0
    max_instance_count = 1

    service_account_email = var.sa_email
  }
}

# ---------------------------------------------------------------------------
# IAM — allow unauthenticated HTTP invocations for whoami
#
# There is no Scheduler involved and no sensitive data is returned, so the
# endpoint is public by design (unlike check_internet_status, which also
# allows unauthenticated calls but relies on Scheduler's own OIDC audience).
# ---------------------------------------------------------------------------

resource "google_cloud_run_service_iam_member" "whoami_invoker" {
  project  = var.project_id
  location = var.whoami_region
  service  = google_cloudfunctions2_function.whoami.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Cloud Function (Gen 2) — send-test-alert
#
# Called directly from the Settings screen's "Test send" buttons to preview an
# email/Telegram alert with the draft (possibly unsaved) subject, body,
# timezone, and date format. IAM allows unauthenticated invocation (needed so
# the browser can call it directly), but the function itself only acts on
# requests carrying a valid Firebase ID token for a member of the target
# household (see _verify_firebase_token/_is_household_member in main.py) —
# the real access control lives in application code here, not in IAM.
# ALERT_EMAIL is unused by this endpoint's authorization; it is only the
# legacy alert-recipient fallback in _load_monitor_config, wired from the
# now-optional var.alert_email (see ADR 0007/Fase 7 of ROADMAP.md).
# ---------------------------------------------------------------------------

resource "google_cloudfunctions2_function" "send_test_alert" {
  name     = "send-test-alert"
  location = var.region

  labels = local.common_labels

  build_config {
    runtime     = "python312"
    entry_point = "send_test_alert"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory   = "256M"
    timeout_seconds    = 30
    min_instance_count = 0
    max_instance_count = 1

    environment_variables = {
      GCP_PROJECT_ID     = var.project_id
      ALERT_EMAIL        = var.alert_email
      FIRESTORE_DATABASE = var.firestore_database
    }

    # Sensitive values injected from Secret Manager at startup — needed for
    # the email channel (Gmail API), unused but harmless for telegram tests.
    secret_environment_variables {
      key        = "GMAIL_CLIENT_ID"
      project_id = var.project_id
      secret     = data.google_secret_manager_secret.gmail_client_id.secret_id
      version    = "latest"
    }

    secret_environment_variables {
      key        = "GMAIL_CLIENT_SECRET"
      project_id = var.project_id
      secret     = data.google_secret_manager_secret.gmail_client_secret.secret_id
      version    = "latest"
    }

    secret_environment_variables {
      key        = "GMAIL_REFRESH_TOKEN"
      project_id = var.project_id
      secret     = data.google_secret_manager_secret.gmail_refresh_token.secret_id
      version    = "latest"
    }

    service_account_email = var.sa_email
  }
}

resource "google_cloud_run_service_iam_member" "send_test_alert_invoker" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.send_test_alert.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Cloud Function (Gen 2) — send-invite-email
#
# Called directly from the Members screen's "Send invite" button to email an
# existing household member a link to the app and to the client download
# page. IAM allows unauthenticated invocation (needed so the browser can call
# it directly), but the function itself only acts on requests carrying a
# valid Firebase ID token for an owner/admin of the target household, and
# only for an email already present in that household's members[] (see
# _verify_firebase_token/_get_member_role in main.py) — the real access
# control lives in application code here, not in IAM.
# ---------------------------------------------------------------------------

resource "google_cloudfunctions2_function" "send_invite_email" {
  name     = "send-invite-email"
  location = var.region

  labels = local.common_labels

  build_config {
    runtime     = "python312"
    entry_point = "send_invite_email"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory   = "256M"
    timeout_seconds    = 30
    min_instance_count = 0
    max_instance_count = 1

    environment_variables = {
      GCP_PROJECT_ID     = var.project_id
      FIRESTORE_DATABASE = var.firestore_database
    }

    # Sensitive values injected from Secret Manager at startup — needed to
    # send the invite via the Gmail API.
    secret_environment_variables {
      key        = "GMAIL_CLIENT_ID"
      project_id = var.project_id
      secret     = data.google_secret_manager_secret.gmail_client_id.secret_id
      version    = "latest"
    }

    secret_environment_variables {
      key        = "GMAIL_CLIENT_SECRET"
      project_id = var.project_id
      secret     = data.google_secret_manager_secret.gmail_client_secret.secret_id
      version    = "latest"
    }

    secret_environment_variables {
      key        = "GMAIL_REFRESH_TOKEN"
      project_id = var.project_id
      secret     = data.google_secret_manager_secret.gmail_refresh_token.secret_id
      version    = "latest"
    }

    service_account_email = var.sa_email
  }
}

resource "google_cloud_run_service_iam_member" "send_invite_email_invoker" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.send_invite_email.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Cloud Function (Gen 2) — issue-api-key
#
# Called directly from the Client screen's "Generate API key" button to let
# an owner/admin self-issue a Rust client API key without an operator
# running scripts/issue_api_key.py manually. IAM allows unauthenticated
# invocation (needed so the browser can call it directly), but the function
# itself only acts on requests carrying a valid Firebase ID token for an
# owner/admin of the target household (see _verify_firebase_token/
# _get_member_role in main.py) — the real access control lives in
# application code here, not in IAM. No Gmail secrets needed.
# ---------------------------------------------------------------------------

resource "google_cloudfunctions2_function" "issue_api_key" {
  name     = "issue-api-key"
  location = var.region

  labels = local.common_labels

  build_config {
    runtime     = "python312"
    entry_point = "issue_api_key"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory   = "256M"
    timeout_seconds    = 10
    min_instance_count = 0
    max_instance_count = 1

    environment_variables = {
      GCP_PROJECT_ID     = var.project_id
      FIRESTORE_DATABASE = var.firestore_database
    }

    service_account_email = var.sa_email
  }
}

resource "google_cloud_run_service_iam_member" "issue_api_key_invoker" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.issue_api_key.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Cloud Function (Gen 2) — ingest-heartbeat
#
# Fase 2 of docs/adr/ROADMAP.md (ADR 0004, 0010). Replaces the Rust client's
# direct Firestore writes: it now sends a plain HTTP POST with a per-household
# API key instead of holding a GCP Service Account credential. IAM allows
# unauthenticated invocation (the client has no GCP identity) — access control
# is enforced in application code via the API key hash check (see
# ingest.py::_authenticate).
# ---------------------------------------------------------------------------

resource "google_cloudfunctions2_function" "ingest_heartbeat" {
  name     = "ingest-heartbeat"
  location = var.region

  labels = local.common_labels

  build_config {
    runtime     = "python312"
    entry_point = "ingest_heartbeat"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    # Called once per minute per household — generous headroom is unneeded.
    available_memory   = "256M"
    timeout_seconds    = 10
    min_instance_count = 0
    max_instance_count = 1

    environment_variables = {
      GCP_PROJECT_ID     = var.project_id
      FIRESTORE_DATABASE = var.firestore_database
    }

    service_account_email = var.sa_email
  }
}

resource "google_cloud_run_service_iam_member" "ingest_heartbeat_invoker" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.ingest_heartbeat.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Cloud Function (Gen 2) — ingest-speedtest
#
# Same rationale and auth model as ingest-heartbeat above, for the
# lower-frequency (roughly hourly) speedtest measurement.
# ---------------------------------------------------------------------------

resource "google_cloudfunctions2_function" "ingest_speedtest" {
  name     = "ingest-speedtest"
  location = var.region

  labels = local.common_labels

  build_config {
    runtime     = "python312"
    entry_point = "ingest_speedtest"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory   = "256M"
    timeout_seconds    = 10
    min_instance_count = 0
    max_instance_count = 1

    environment_variables = {
      GCP_PROJECT_ID     = var.project_id
      FIRESTORE_DATABASE = var.firestore_database
    }

    service_account_email = var.sa_email
  }
}

resource "google_cloud_run_service_iam_member" "ingest_speedtest_invoker" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.ingest_speedtest.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Cloud Function (Gen 2) — list-households
#
# Called from the platform admin screen to list every household's
# account-level metadata (name, status, owner email) — never a household's
# private data (speedtest results, IPs, monitor config). IAM allows
# unauthenticated invocation (needed so the browser can call it directly),
# but the function itself only acts on requests carrying a valid Firebase ID
# token whose email matches var.super_admin_email (see SUPER_ADMIN_EMAIL/
# _verify_firebase_token in main.py) — the real access control lives in
# application code here, not in IAM.
# ---------------------------------------------------------------------------

resource "google_cloudfunctions2_function" "list_households" {
  name     = "list-households"
  location = var.region

  labels = local.common_labels

  build_config {
    runtime     = "python312"
    entry_point = "list_households"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory   = "256M"
    timeout_seconds    = 30
    min_instance_count = 0
    max_instance_count = 1

    environment_variables = {
      GCP_PROJECT_ID     = var.project_id
      FIRESTORE_DATABASE = var.firestore_database
      SUPER_ADMIN_EMAIL  = var.super_admin_email
    }

    service_account_email = var.sa_email
  }
}

resource "google_cloud_run_service_iam_member" "list_households_invoker" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.list_households.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Cloud Function (Gen 2) — set-household-status
#
# Called from the platform admin screen to activate/deactivate a household.
# Same access-control model as list-households: IAM allows unauthenticated
# invocation, but the function itself only acts on requests carrying a valid
# Firebase ID token whose email matches var.super_admin_email.
# ---------------------------------------------------------------------------

resource "google_cloudfunctions2_function" "set_household_status" {
  name     = "set-household-status"
  location = var.region

  labels = local.common_labels

  build_config {
    runtime     = "python312"
    entry_point = "set_household_status"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory   = "256M"
    timeout_seconds    = 30
    min_instance_count = 0
    max_instance_count = 1

    environment_variables = {
      GCP_PROJECT_ID     = var.project_id
      FIRESTORE_DATABASE = var.firestore_database
      SUPER_ADMIN_EMAIL  = var.super_admin_email
    }

    service_account_email = var.sa_email
  }
}

resource "google_cloud_run_service_iam_member" "set_household_status_invoker" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.set_household_status.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
