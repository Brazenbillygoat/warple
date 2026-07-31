# Migration roadmap

Warple is being modernized in small slices so dependency changes stay understandable, testable, and reversible. This file records the current order and risk. It is not a promise that every migration will happen immediately.

## Current priority

| Order | Migration | Why | Risk | Urgency |
| --- | --- | --- | --- | --- |
| 1 | Mantine 7 to 9 | Brings the settings UI onto the current major version | High | Later |
| 2 | Zustand, i18next, react-i18next, and other small libraries | Reduces routine dependency drift | Low to medium | Opportunistic |
| 3 | TypeScript 7 and Rust edition 2024 | Modernizes compiler and language baselines | Medium | Later |
| 4 | Phaser 3 to 4 | Moves the behavior and physics engine to its next major generation | Very high | Last, after stronger behavior tests |

## Completed: Warple application identity

The project-owned package, crate, product, executable, bundle, Tauri identifier, configuration root, user-facing branding, and release artifact identity now use Warple. Tauri's identifier is `io.github.brazenbillygoat.warple`, and runtime configuration uses its standard identifier-derived `$APPCONFIG` directory.

No external users or retained custom data depended on the legacy identity, so the rebrand deliberately starts with fresh defaults. Legacy `%APPDATA%\WindowPet` data remains untouched and is not read, copied, moved, or deleted. WindowPet references remain only for upstream, historical, license, and bundled-artwork attribution.

## Completed: React Router advisory

The former advisory, [`GHSA-qwww-vcr4-c8h2`](https://github.com/advisories/GHSA-qwww-vcr4-c8h2), affected unstable React Server Component APIs included in React Router. Warple uses React Router only for client-side navigation inside Tauri. It has no React server, server actions, or RSC configuration, so the vulnerable execution path was not used.

The coordinated migration moved React and React DOM to 19.2.8, replaced `react-router-dom` with React Router 8.3.0, moved Testing Library to 16.3.2 with its DOM peer, and moved Tabler Icons to 3.46.0. Mantine remains on version 7. The application remains declarative and client-only, focused routing tests pass, and `npm audit` reports no vulnerabilities.

Manual desktop review remains required before the migration is merged.

## Delivery rules

Each major migration gets its own branch, compatibility review, focused tests, production frontend build, desktop build, and user-owned manual run. Unrelated migrations should not be bundled together merely because newer versions are available.

The Phaser migration should wait until pet states, movement, and physics have enough automated coverage to catch behavior regressions.
