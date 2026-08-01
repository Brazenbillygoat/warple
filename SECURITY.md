# Security policy

## Supported versions

Warple is still pre-release. Security fixes are applied to the current `main` branch. No packaged release is currently supported as a stable security-maintenance line.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's private [Report a vulnerability](https://github.com/Brazenbillygoat/warple/security/advisories/new) form instead. Include the affected version or commit, operating system, reproduction steps, expected impact, and a minimal proof of concept when practical. Remove credentials, personal files, and unrelated private data before submitting anything.

Useful reports include capability escapes, bypasses of the built-in profile validator or artwork registry, startup-handshake abuse, unintended command execution, credential exposure, and unexpected filesystem or network access.

Reports will be reviewed privately. Please allow time for investigation and a coordinated fix before publishing technical details.

## Current security boundary

Companion profiles are bundled declarative data validated before Phaser mounts. They cannot supply executable code, paths, arbitrary artwork URLs, or permissions. The overlay can only signal one-shot startup readiness or failure and request native cursor coordinates. It has no filesystem, shell, dialog, opener, screen-capture, network, process, or UI-control permission.
