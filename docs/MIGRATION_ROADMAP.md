# Migration roadmap

Warple is being modernized in small slices so dependency changes stay understandable, testable, and reversible. This file records the current order and risk. It is not a promise that every migration will happen immediately.

## Current priority

| Order | Migration | Why | Risk | Urgency |
| --- | --- | --- | --- | --- |
| 1 | React 19, React Router 8, Testing Library 16, and Tabler Icons 3 | Removes the current React Router security advisory and satisfies the related peer requirements | Medium | Soon |
| 2 | WindowPet identifiers and user data to Warple | Finishes the product rename without abandoning existing settings or custom pets | High | Before the installed user base grows |
| 3 | Mantine 7 to 9 | Brings the settings UI onto the current major version | High | Later |
| 4 | Zustand, i18next, react-i18next, and other small libraries | Reduces routine dependency drift | Low to medium | Opportunistic |
| 5 | TypeScript 7 and Rust edition 2024 | Modernizes compiler and language baselines | Medium | Later |
| 6 | Phaser 3 to 4 | Moves the behavior and physics engine to its next major generation | Very high | Last, after stronger behavior tests |

## React Router advisory

The current advisory, [`GHSA-qwww-vcr4-c8h2`](https://github.com/advisories/GHSA-qwww-vcr4-c8h2), affects unstable React Server Component APIs included in React Router. Warple uses React Router only for client-side navigation inside Tauri. It has no React server, server actions, or RSC configuration, so the vulnerable execution path is not currently used.

The advisory is still worth removing. React Router 8.3.0 is the first patched release, but the [React Router 8 upgrade requirements](https://reactrouter.com/upgrading/v7) include React and React DOM 19.2.7 or newer. Version 8 also removes the `react-router-dom` compatibility package. Warple's Node 22.23 and Vite 8 baselines already satisfy the remaining requirements.

That makes the first migration a coordinated compatibility slice:

- Move React and React DOM to 19.2.7 or newer.
- Replace `react-router-dom` with patched `react-router` 8 and update imports.
- Move Testing Library to a React 19-compatible release.
- Move Tabler Icons to version 3 because the installed version 2 package does not declare React 19 support.
- Keep Mantine 7 during this slice because the installed Mantine packages already declare React 19 support.

## Delivery rules

Each major migration gets its own branch, compatibility review, focused tests, production frontend build, desktop build, and user-owned manual run. Unrelated migrations should not be bundled together merely because newer versions are available.

The WindowPet-to-Warple identifier migration needs an explicit data migration and rollback path. The Phaser migration should wait until pet states, movement, and physics have enough automated coverage to catch behavior regressions.
