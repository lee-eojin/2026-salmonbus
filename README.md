# Push notification proof assets (2026-11-08, Asia/Seoul)

This orphan branch holds demo screenshots, videos, and structure diagrams
for the SAL-308 / SAL-309 / SAL-310 / SAL-313 pull requests.
It is not product code.

These recordings use a fake APNs server. They are not a real iPhone
notification and not Apple api.push.apple.com.

- screenshots/: demo before the copy/time-display fix
- screenshots-after/: same demo after the fix
- videos/push-e2e-demo.mp4: screen + fake APNs before the fix
- videos/after-fix.mp4: screen + fake APNs after the fix
- videos/push-send-demo.mp4: SAL-310 unit-level send against a fake APNs server
- diagrams/: structure drawings

The visible device token in the APNs log is a fake repeating hex string.
Authorization is shown as "fake local JWT"; cookie values are not included.
