#!/usr/bin/env python3
"""
DL-380: Idempotent script to add schema fields for password-protected documents.

Adds fields to 'pending_classifications' table and updates 'email_events'
select options via Airtable Meta API.
"""

import os
import sys
import requests
import json

BASE_ID = "appqBL5RWQN9cPOyh"
PENDING_CLASS_TABLE_ID = "tbloiSDN3rwRcl1ii"
META_API_BASE = "https://api.airtable.com/v0/meta/bases"

# Fields to add to pending_classifications
FIELDS_TO_ADD = [
    {
        "name": "password_request_sent_at",
        "type": "dateTime",
        "options": {
            "dateFormat": {"name": "iso"},
            "timeFormat": {"name": "24hour"},
            "timeZone": "utc"
        }
    },
    {
        "name": "suggested_password",
        "type": "singleLineText"
    },
    {
        "name": "password_reply_raw",
        "type": "multilineText"
    }
]

def get_token():
    """Get Airtable PAT from environment."""
    token = os.environ.get('AIRTABLE_PAT')
    if not token:
        print("ERROR: AIRTABLE_PAT environment variable not set", file=sys.stderr)
        sys.exit(1)
    return token

def make_request(method, url, token, data=None):
    """Make authenticated request to Airtable API."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    if method == "GET":
        response = requests.get(url, headers=headers)
    elif method == "POST":
        response = requests.post(url, headers=headers, json=data)
    elif method == "PATCH":
        response = requests.patch(url, headers=headers, json=data)
    else:
        print(f"ERROR: Unsupported HTTP method {method}", file=sys.stderr)
        sys.exit(1)

    if response.status_code < 200 or response.status_code >= 300:
        print(f"ERROR: {method} {url}", file=sys.stderr)
        print(f"Status: {response.status_code}", file=sys.stderr)
        print(f"Response: {response.text}", file=sys.stderr)
        sys.exit(1)

    return response.json()

def get_existing_fields(token, table_id):
    """Get all fields for a table."""
    url = f"{META_API_BASE}/{BASE_ID}/tables/{table_id}/fields"
    data = make_request("GET", url, token)
    return {field["name"]: field for field in data.get("fields", [])}

def add_field(token, table_id, field_config):
    """Add a field to a table (with idempotency check)."""
    existing_fields = get_existing_fields(token, table_id)
    field_name = field_config["name"]

    if field_name in existing_fields:
        print(f"SKIP: {field_name} already exists")
        return False

    url = f"{META_API_BASE}/{BASE_ID}/tables/{table_id}/fields"
    make_request("POST", url, token, field_config)
    print(f"Added field: {field_name}")
    return True

def find_table_by_name(token, table_name):
    """Find table ID by name using Meta API."""
    url = f"{META_API_BASE}/{BASE_ID}/tables"
    data = make_request("GET", url, token)

    for table in data.get("tables", []):
        if table["name"] == table_name:
            return table["id"]

    print(f"ERROR: Table '{table_name}' not found in base", file=sys.stderr)
    sys.exit(1)

def add_select_option(token, table_id, field_id, option_name):
    """Add option to a singleSelect field (with idempotency check)."""
    # Get current field definition
    url = f"{META_API_BASE}/{BASE_ID}/tables/{table_id}/fields/{field_id}"
    field_data = make_request("GET", url, token)

    options = field_data.get("options", {}).get("choices", [])

    # Check if option already exists
    if any(choice["name"] == option_name for choice in options):
        print(f"SKIP: {option_name} already in processing_status choices")
        return False

    # Add new option
    new_option = {"name": option_name}
    options.append(new_option)

    # PATCH the field with updated options
    updated_field = {
        "options": {
            "choices": options
        }
    }
    make_request("PATCH", url, token, updated_field)
    print(f"Added option {option_name} to processing_status")
    return True

def main():
    """Main entrypoint."""
    token = get_token()

    fields_added = 0
    fields_skipped = 0

    # Add fields to pending_classifications
    print(f"Adding fields to pending_classifications (table: {PENDING_CLASS_TABLE_ID})...")
    for field_config in FIELDS_TO_ADD:
        if add_field(token, PENDING_CLASS_TABLE_ID, field_config):
            fields_added += 1
        else:
            fields_skipped += 1

    # Find email_events table and add PasswordReply option
    print("\nUpdating email_events table...")
    email_events_table_id = find_table_by_name(token, "email_events")
    print(f"Found email_events table: {email_events_table_id}")

    # Get all fields to find processing_status
    existing_fields = get_existing_fields(token, email_events_table_id)
    if "processing_status" not in existing_fields:
        print("ERROR: processing_status field not found in email_events table", file=sys.stderr)
        sys.exit(1)

    processing_status_field = existing_fields["processing_status"]
    field_id = processing_status_field["id"]

    # Add PasswordReply option
    if add_select_option(token, email_events_table_id, field_id, "PasswordReply"):
        fields_added += 1
    else:
        fields_skipped += 1

    # Summary
    print(f"\nDONE: {fields_added} fields added, {fields_skipped} skipped.")

if __name__ == "__main__":
    main()
