# Push review — 2026-11-07

The reported Android test is accepted but no notification appears. The iPhone receives notifications, while its diagnostics incorrectly show orange.

## Verified findings

- Android is a Trusted Web Activity using browser Web Push. Notification permission, delegation service and the service worker push handler are present. This review found no missing manifest permission.
- Diagnostics used browser Web Push even on native iOS, ignoring its APNs registration.
- Web activation reused an existing subscription even when marked invalid by the server; saving it re-enabled that endpoint. Recovery now rotates invalid, expired or mismatched-key subscriptions and provides explicit renewal.
- Provider success was described as confirmed delivery. It now explicitly means acceptance only.
- The onboarding dismissal flag was shared across accounts; it is now scoped to the current account.

## Read-only production evidence

The seven-day delivery log had 338 Google provider acceptances (HTTP 201), latest 2026-11-07 03:14 UTC, and one expired subscription failure (HTTP 410) on November 4. Native iOS last success was 2026-11-07 20:21 UTC. Provider acceptance does not demonstrate display on Android. No production push was sent during this investigation.

## Changes and validation

Registration recovery, account-change guards and overlapping-registration protection have regression tests. Diagnostics now require matching local/server registration and permission, use native iOS status, and avoid claiming display confirmation. Android settings offer a local notification test to distinguish display from network delivery. The helper is included in web cache and native asset packaging.

No database migration or server function change. These branches are review candidates, not a production deployment. No physical Android validation was performed, and the specific cause on the reported handset remains unconfirmed.

## Device validation after deployment

1. Record Android model/version, installed app/browser versions, account and exact test time.
2. Confirm notification permission and categories for Tâmo On and its browser provider.
3. Run the local display test and check the notification shade, not just the banner.
4. Run the remote test on this device and correlate its timestamp with server delivery attempts.
5. If local display works but the remote test does not, renew this device's registration and repeat once. Check foreground, background and locked-screen cases.
6. On iPhone, verify that an active native registration is green and both foreground/background push remain functional.
