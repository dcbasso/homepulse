# ---------------------------------------------------------------------------
# Input variables
#
# Values are supplied via terraform.tfvars (gitignored).
# See terraform.tfvars.example for a template.
# ---------------------------------------------------------------------------

variable "project_id" {
  type        = string
  description = "GCP project ID (e.g. REDACTED_PROJECT_ID)"
}

variable "region" {
  type        = string
  default     = "southamerica-east1"
  description = "GCP region for Cloud Function and Cloud Scheduler"
}

variable "whoami_region" {
  type        = string
  default     = "us-central1"
  description = "GCP region for the whoami function. Must be a region that supports Cloud Run domain mappings (southamerica-east1 does not), since this function is exposed under a custom domain."
}

variable "alert_email" {
  type        = string
  default     = ""
  description = "Legacy fallback recipient for up/down alert emails, used only when a household has no `alert_emails` configured in its `monitor_config` (see ADR 0007/Fase 7 of ROADMAP.md — alert recipients are now per-household, not a single global variable). Optional; leave empty to disable the fallback."
}

variable "sa_email" {
  type        = string
  description = "Service Account email created during pre-requisites setup"
}

variable "max_minutes_without_data" {
  type        = number
  default     = 5
  description = "Minutes without a Firestore document before an alert is triggered"
}

variable "firestore_database" {
  type        = string
  default     = "speedtest-monitordb-one"
  description = "Name of the Firestore database used by the client and this function (not the project's \"(default)\" database)"
}

variable "super_admin_email" {
  type        = string
  description = "Email of the single platform-wide super-admin allowed to call list-households and see every household's account-level metadata (name, status, owner email) — never their private data."
}
