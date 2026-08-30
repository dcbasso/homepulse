"""
One-time script to obtain the Gmail OAuth2 refresh token.

Usage:
  1. Download the OAuth2 client credentials JSON from GCP Console
     (APIs & Services → Clients) and save it as `client_secret.json`
     in this same folder (gitignored — never commit it).
  2. Run: python get_refresh_token.py
  3. A browser window will open — sign in with the alert-sending Google
     account and grant the `gmail.send` permission.
  4. Copy the printed refresh_token and store it in Secret Manager
     (see README "Gmail OAuth" section).

Requirements:
  pip install --user google-auth-oauthlib
"""

import os
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]

SECRET_FILE = os.path.join(os.path.dirname(__file__), "client_secret.json")


def main() -> None:
    """Run the OAuth2 flow and print the refresh token."""
    if not os.path.exists(SECRET_FILE):
        raise FileNotFoundError(
            f"client_secret.json not found at {SECRET_FILE}\n"
            "Download it from GCP Console → Google Auth Platform → Clients "
            "and place it in this folder."
        )

    flow = InstalledAppFlow.from_client_secrets_file(SECRET_FILE, scopes=SCOPES)
    creds = flow.run_local_server(port=0)

    print("\n--- Copy these values to Secret Manager ---")
    print(f"refresh_token: {creds.refresh_token}")
    print(f"client_id:     {creds.client_id}")
    print(f"client_secret: {creds.client_secret}")
    print("--------------------------------------------\n")


if __name__ == "__main__":
    main()
