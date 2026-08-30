# ---------------------------------------------------------------------------
# Terraform configuration
#
# Requires:
#   - google provider >= 5.0
#   - google-beta provider >= 5.0 (needed for Firebase Hosting resource)
#
# Run: terraform init && terraform apply -var-file=terraform.tfvars
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0, < 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 5.0, < 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.0"
    }
  }
}

# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# ---------------------------------------------------------------------------
# Common locals
#
# All resources use the `project` label so cost reports and terraform destroy
# can target the homepulse project in isolation.
# ---------------------------------------------------------------------------

locals {
  common_labels = {
    project = "homepulse"
  }
}
