#!/usr/bin/env python3
"""
DL-382: Idempotent script to add password_request_token field.

Adds singleLineText field 'password_request_token' to 'pending_classifications'
so batch password requests can fan out the same token to multiple records.

Usage: AIRTABLE_PAT="$AIRTABLE_API_KEY" python3 scripts/dl382-add-token-field.py
"""

import os
import sys
import requests

BASE_ID = "appqBL5RWQN9cPOyh"
PENDING_CLASS_TABLE_ID = "tbloiSDN3rwRcl1ii"
META_API_BASE = "https://api.airtable.com/v0/meta/bases"

FIELD_TO_ADD = {
    "name": "password_request_token",
    "type": "singleLineText"
}


def get_token():
    token = os.environ.get('AIRTABLE_PAT')
    if not token:
        print("ERROR: AIRTABLE_PAT environment variable not set", file=sys.stderr)
        sys.exit(1)
    return token


def make_request(method, url, token, data=None):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if method == "GET":
        response = requests.get(url, headers=headers)
    elif method == "POST":
        response = requests.post(url, headers=headers, json=data)
    else:
        sys.exit(f"Unsupported method {method}")

    if response.status_code < 200 or response.status_code >= 300:
        print(f"ERROR: {method} {url} -> {response.status_code}", file=sys.stderr)
        print(f"Response: {response.text}", file=sys.stderr)
        sys.exit(1)
    return response.json()


def get_existing_field_names(token, table_id):
    # Use GET /tables and filter — avoids /fields endpoint issues
    url = f"{META_API_BASE}/{BASE_ID}/tables"
    data = make_request("GET", url, token)
    for table in data.get("tables", []):
        if table["id"] == table_id:
            return {f["name"] for f in table.get("fields", [])}
    print(f"ERROR: Table {table_id} not found", file=sys.stderr)
    sys.exit(1)


def main():
    token = get_token()
    field_name = FIELD_TO_ADD["name"]

    print(f"Checking pending_classifications ({PENDING_CLASS_TABLE_ID}) for '{field_name}'...")
    existing = get_existing_field_names(token, PENDING_CLASS_TABLE_ID)

    if field_name in existing:
        print(f"SKIP: '{field_name}' already exists — nothing to do.")
        return

    url = f"{META_API_BASE}/{BASE_ID}/tables/{PENDING_CLASS_TABLE_ID}/fields"
    make_request("POST", url, token, FIELD_TO_ADD)
    print(f"Added field: {field_name}")
    print("DONE.")


if __name__ == "__main__":
    main()
