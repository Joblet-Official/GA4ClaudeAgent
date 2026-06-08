"""
Generate catalog/ga4_catalog.json — the single source of truth for valid GA4
field names used by Brain 2 to ground its query generation.

Sources:
  1. GA4 Data API metadata endpoint → all dimensions + metrics on property
     516147906 (built-in + custom).
  2. gtm_snapshot.latest.json (from sibling joveo dir) → joblet-specific event
     names sent by the GTM container. Templated event names (`{{...}}`) are
     surfaced as `limitations` rather than queryable events.

Treats GTM as read-only — only consumes the snapshot file written by
pull_gtm_tags.py. Never calls the GTM API or modifies anything.

Run:
  python scripts/refresh_catalog.py

Re-run after `pull_gtm_tags.py` to roll new/changed events into the catalog.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from google.oauth2 import service_account
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import GetMetadataRequest

# Paths
PROJECT_DIR = Path(__file__).resolve().parent.parent
CATALOG_DIR = PROJECT_DIR / "catalog"
CATALOG_FILE = CATALOG_DIR / "ga4_catalog.json"
GTM_SNAPSHOT = PROJECT_DIR.parent / "gtm_snapshot.latest.json"  # E:\Documents\joveo\gtm_snapshot.latest.json

# Hard-coded for this project (per plan)
KEY_FILE = r"C:\Users\zbali\Downloads\ga4-claude-connection-491910-36e55f7c46d4 (1).json"
PROPERTY_ID = "516147906"


def pull_ga4_metadata():
    """Fetch all dimensions + metrics for the property via GA4 Data API metadata."""
    creds = service_account.Credentials.from_service_account_file(
        KEY_FILE, scopes=["https://www.googleapis.com/auth/analytics.readonly"]
    )
    client = BetaAnalyticsDataClient(credentials=creds)
    req = GetMetadataRequest(name=f"properties/{PROPERTY_ID}/metadata")
    md = client.get_metadata(req)

    dimensions = []
    for d in md.dimensions:
        dimensions.append({
            "api_name": d.api_name,
            "ui_name": d.ui_name,
            "category": d.category,
            "description": d.description,
            "custom_definition": d.custom_definition,
        })

    metrics = []
    for m in md.metrics:
        metrics.append({
            "api_name": m.api_name,
            "ui_name": m.ui_name,
            "category": m.category,
            "description": m.description,
            "type": m.type_.name if hasattr(m.type_, "name") else str(m.type_),
            "custom_definition": m.custom_definition,
        })

    return dimensions, metrics


def pull_gtm_events():
    """Extract joblet-specific event names from the GTM snapshot.

    Returns (events, templated). `events` are concrete names safe to query
    against GA4 (event=share_open). `templated` are tags whose eventName is a
    variable reference like {{dlv - job_id}} — those resolve at runtime and
    can't be enumerated here; we surface them as limitations.
    """
    if not GTM_SNAPSHOT.exists():
        return [], [{
            "note": f"GTM snapshot not found at {GTM_SNAPSHOT}. Run pull_gtm_tags.py to refresh.",
        }]

    with open(GTM_SNAPSHOT, "r", encoding="utf-8") as f:
        snap = json.load(f)

    events = {}
    templated = []
    for acct in snap.get("accounts", []):
        for cont in acct.get("containers", []):
            for ws in cont.get("workspaces", []):
                for tag in ws.get("tags", []):
                    # Only GA4 event tags (gaawe = "Google Analytics: GA4 Event")
                    if tag.get("type") != "gaawe":
                        continue
                    event_name = None
                    for param in tag.get("parameter", []):
                        if param.get("key") == "eventName":
                            event_name = param.get("value")
                            break
                    if not event_name:
                        continue
                    if "{{" in event_name:
                        templated.append({
                            "tag_name": tag.get("name"),
                            "event_name_template": event_name,
                        })
                    else:
                        # Dedupe; keep first tag pointing at this event
                        if event_name not in events:
                            events[event_name] = {
                                "name": event_name,
                                "source": "gtm",
                                "from_tag": tag.get("name"),
                            }
    return list(events.values()), templated


def build_limitations(templated):
    """Static + runtime limitations notes."""
    limitations = [
        "Sampling kicks in above ~10M sessions per query (GA4 Data API).",
        "Last 24-48h of data may be incomplete (GA4 ingestion lag).",
        "Custom event names must match ^[a-zA-Z][a-zA-Z0-9_]*$. Names with '&' or '-' are silently rejected by GA4.",
        "GA4 caps custom event names at 500 unique values per property; tags that emit job-specific event names (e.g. 'JD_VIEW_TAG') will lose data on the long tail.",
    ]
    for t in templated:
        limitations.append(
            f"Tag '{t['tag_name']}' emits a templated eventName "
            f"({t['event_name_template']}) — high-cardinality, treated as untracked here."
        )
    return limitations


def main():
    CATALOG_DIR.mkdir(exist_ok=True)

    print(f"Pulling GA4 metadata for property {PROPERTY_ID}...")
    dimensions, metrics = pull_ga4_metadata()
    print(f"  {len(dimensions)} dimensions, {len(metrics)} metrics")

    print(f"Reading GTM snapshot from {GTM_SNAPSHOT.name}...")
    events, templated = pull_gtm_events()
    print(f"  {len(events)} literal event names, {len(templated)} templated (excluded)")

    catalog = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "property_id": PROPERTY_ID,
        "source": {
            "ga4_metadata_api": True,
            "gtm_snapshot": GTM_SNAPSHOT.name,
        },
        "dimensions": dimensions,
        "metrics": metrics,
        "events": sorted(events, key=lambda e: e["name"]),
        "limitations": build_limitations(templated),
    }

    with open(CATALOG_FILE, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)

    print(f"\nCatalog written: {CATALOG_FILE.relative_to(PROJECT_DIR)}")
    print(f"  schema_version: {catalog['schema_version']}")
    print(f"  generated_at:   {catalog['generated_at']}")
    print(f"  dimensions:     {len(dimensions)}")
    print(f"  metrics:        {len(metrics)}")
    print(f"  events:         {len(events)}  ({', '.join(e['name'] for e in catalog['events'])})")
    print(f"  limitations:    {len(catalog['limitations'])}")


if __name__ == "__main__":
    main()
