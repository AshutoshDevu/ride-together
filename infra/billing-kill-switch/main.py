"""Budget kill switch: unlinks billing from the project once the monthly budget is reached.

Triggered by the "RideTogether ₹500 cap" budget via the `budget-alerts` Pub/Sub topic.
With billing off, paid APIs (Google Maps) stop; Firebase falls back to its free Spark limits.
Re-enable billing in the Cloud console to restore it.
"""
import base64
import json
import os

import functions_framework
from googleapiclient import discovery

PROJECT_ID = os.environ["TARGET_PROJECT"]


@functions_framework.cloud_event
def stop_billing(cloud_event):
    data = json.loads(base64.b64decode(cloud_event.data["message"]["data"]).decode())
    cost, budget = data["costAmount"], data["budgetAmount"]
    print(f"Spend {cost} of budget {budget} {data.get('currencyCode', '')}")
    if cost < budget:
        return

    billing = discovery.build("cloudbilling", "v1", cache_discovery=False)
    name = f"projects/{PROJECT_ID}"
    if not billing.projects().getBillingInfo(name=name).execute().get("billingEnabled"):
        print("Billing already disabled")
        return
    billing.projects().updateBillingInfo(name=name, body={"billingAccountName": ""}).execute()
    print(f"Budget reached — billing disabled for {PROJECT_ID}")
