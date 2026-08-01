# Migration roadmap

Warple is being modernized in small slices so dependency changes stay understandable, testable, and reversible. This file records the current order and risk. It is not a promise that every migration will happen immediately.

## Current priority

| Order | Migration | Why | Risk | Urgency |
| --- | --- | --- | --- | --- |
| 1 | Remaining supporting libraries | Reassesses dependency drift against the smaller tray-only application | Low to medium | Opportunistic |
| 2 | TypeScript 7 and Rust edition 2024 | Modernizes compiler and language baselines | Medium | Later |
| 3 | Phaser 3 to 4 | Moves the behavior and physics engine to its next major generation | Very high | Last, after stronger behavior tests |

The former Mantine 7-to-9 migration is canceled. Warple's approved direction removes the general settings UI and Mantine dependency instead of upgrading a surface the product no longer needs.

## Completed: tray-only companion-profile foundation

Warple now launches one built-in, validated, declarative Blooky profile through a hidden primary-display overlay and a generation-bound readiness handshake. The native lifecycle owns initial launch, resume, tray double-click, second launch, pause, restart, quit, display resolution, and graceful exit behavior.

The settings window, pet catalog, custom-pet editor, persisted configuration path, localization UI, 49 unused profiles and their sheets, settings-only dependencies, filesystem/dialog/opener plugins, settings capability, and custom-asset protocol were removed. Existing on-disk Warple and WindowPet data remains untouched, and diagnostic logging uses Tauri's standard log directory.

## Completed: Warple application identity

The project-owned package, crate, product, executable, bundle, Tauri identifier, configuration root, user-facing branding, and release artifact identity now use Warple. Tauri's identifier is `io.github.brazenbillygoat.warple`, and runtime configuration uses its standard identifier-derived `$APPCONFIG` directory.

No external users or retained custom data depended on the legacy identity, so the rebrand deliberately starts with fresh defaults. Legacy `%APPDATA%\WindowPet` data remains untouched and is not read, copied, moved, or deleted. WindowPet references remain only for upstream, historical, license, and bundled-artwork attribution.

## Completed: React Router advisory

The former advisory, [`GHSA-qwww-vcr4-c8h2`](https://github.com/advisories/GHSA-qwww-vcr4-c8h2), affected unstable React Server Component APIs included in React Router. Warple uses React Router only for client-side navigation inside Tauri. It has no React server, server actions, or RSC configuration, so the vulnerable execution path was not used.

The coordinated migration moved React and React DOM to 19.2.8 and replaced `react-router-dom` with React Router 8.3.0. The later tray-only profile foundation removed React Router, Mantine, Testing Library, Tabler Icons, and the rest of the former settings-only frontend stack. The application remains declarative and client-only, and `npm audit` reports no vulnerabilities.

Manual desktop review remains required before the migration is merged.

## Delivery rules

Each major migration gets its own branch, compatibility review, focused tests, production frontend build, desktop build, and user-owned manual run. Unrelated migrations should not be bundled together merely because newer versions are available.

The Phaser migration should wait until pet states, movement, and physics have enough automated coverage to catch behavior regressions.
