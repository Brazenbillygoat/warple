<div align="center">
    <img width="180" src="./public/media/icon.png" alt="Warple ladybug mascot">
    <h1 align="center">Warple</h1>
    <p align="center">A little desktop companion that wanders, rests, climbs, and hangs out without trying to become your full-time job.</p>
    <img src="https://img.shields.io/badge/Windows-0078D6?style=flat&logo=windows&logoColor=white" alt="Windows">
    <img src="https://img.shields.io/badge/macOS-adb8c5?style=flat&logo=macos" alt="macOS">
    <img src="https://img.shields.io/badge/Linux-1793D1?style=flat&logo=linux&logoColor=white" alt="Linux">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license">
</div>

## What is Warple?

Warple is a manually launched, tray-resident desktop companion built with Tauri, React, and Phaser. It loads one selected built-in, versioned, validated `CompanionProfile` and renders one companion inside the primary display's usable work area.

The built-in catalog contains Blooky and Jo. Blooky is adapted from the fully animated definition and artwork bundled by upstream WindowPet, and its [existing source page](https://undertaleshimejis.tumblr.com/post/140301252826/thank-you-for-6000-followers-here-i-present?is_related_post=1) remains credited. Jo is an original character and original pixel art by Hyrum Butler; the character's attribution links to [Hyrum's site](https://brazenbillygoat.github.io/mysite/).

Warple began as a fork of [WindowPet](https://github.com/SeakMengs/WindowPet) by [SeakMengs](https://github.com/SeakMengs). WindowPet provided the original application and pet engine. That work remains credited while the current project's application-owned identity uses Warple.

## Current behavior

- Starts only when the user launches it; no operating-system autostart
- Runs one selected Blooky or Jo companion on the operating system's primary display
- Keeps the companion inside the display's complete usable work area
- Supports calm weighted states, walking, dragging and throwing, falling, climbing, and crawling
- Jo occasionally performs a rare MJ-spin flourish during ordinary calm behavior
- Jo enters and leaves sit through authored sit-down and stand-up transitions, shows authored ceiling-hang and wall-contact poses while pausing on surfaces, and uses an authored front-facing idle animation
- Uses a click-through transparent overlay that accepts input only over visible companion pixels
- Exposes `Show/Resume`, `Pause`, `Restart`, `Character`, and `Quit` through the tray
- The `Character` submenu lists built-in profiles with a checkmark on the active one; selecting a different profile while running replaces the overlay without restarting the tray, and selecting while paused applies on the next resume
- Keeps the tray alive while paused and treats a second launch as `Show/Resume`
- Persists only the selected built-in profile ID; loads no settings files, custom pets, downloaded profiles, or general configuration UI

The profile boundary is data-only. Profiles cannot execute code, choose paths or URLs for artwork, access files, open links, or request permissions. The `Character` selector lists only built-in profiles; profile downloads, imports, and external profile storage remain unavailable.

## Development

### Requirements

- Node.js `22.23.0`
- npm `10.9.x`
- Rust `1.97.1`
- The platform prerequisites from the [Tauri 2 guide](https://v2.tauri.app/start/prerequisites/)

Install dependencies with `npm ci`.

Jo's checked-in runtime sprite sheet is generated deterministically from the authoritative Aseprite source files. Regenerate it with `npm run assets:jo`, or verify that the source manifest and checked-in PNG agree without writing with `npm run assets:jo:check`.

Run the desktop application only when interactive review is intended:

```bash
npm run devmode
```

Use the tray menu's `Quit` action for a graceful shutdown.

For live desktop IPC inspection, run `npm run devtools`. Select an icon on the
desktop, return to the automatically opened DevTools Console, and inspect:

```text
warpleDesktopDiagnostics.latestActiveEnvironment
warpleDesktopDiagnostics.latestDetails
```

The inspector exists only in the Vite development environment and retains the
latest raw and validated exchanges in memory. It does not write icon values to
application logs.

### Test and build

```bash
npm test -- --run
npm run build
npm audit
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --debug
```

The last command builds the desktop application and installers without launching Warple.

## Architecture

```text
Native primary-display geometry
        -> hidden Tauri overlay (with optional persisted profileId)
        -> synchronous built-in profile resolution and catalog
        -> React mounts Phaser
        -> one companion scene
        -> one-shot startup_ready handshake (generation, profiles, activeProfileId)
        -> lifecycle tray with Character submenu and visible overlay
```

- `src/profiles/` defines, validates, resolves the requested built-in profile, and exports an immutable catalog projection.
- `src/startup.ts` reads the optional `profileId` from the startup URL, resolves the active profile and catalog, and sends them through the one-shot readiness handshake.
- `src/PhaserWrapper.tsx` passes the immutable profile and normalized geometry into Phaser.
- `src/scenes/Pets.ts` owns the companion's animation, input, movement, and physics.
- Tauri owns primary-display resolution, the serialized overlay lifecycle, the readiness handshake, the tray (including the `Character` submenu), single-profile-ID persistence, deferred overlay replacement, and graceful exit behavior.
- Rust exposes only startup signaling and native cursor position to the overlay.

## Local data and safety

Warple persists one narrow native record: the selected built-in profile ID, stored as `selected-profile-id` under Tauri's application config directory. It does not read, create, migrate, or delete any other application configuration data. Existing Warple and legacy WindowPet configuration directories remain untouched. Native diagnostic logs use Tauri's standard log directory.

The overlay has no shell, filesystem, dialog, opener, screen-capture, network, process, or UI-control permission. Screen awareness or interaction would require a separate permission design and explicit review.

## Platform status

Windows automated checks and installer builds have been verified locally. The release workflow is configured for Windows, Intel and Apple Silicon macOS, and Linux, but those release jobs and non-Windows runtime behavior still require verification.

## Inspiration

- [WindowPet](https://github.com/SeakMengs/WindowPet)
- [vscode-pets](https://marketplace.visualstudio.com/items?itemName=tonybaloney.vscode-pets)
- [Shimeji-ee Desktop Pet](https://kilkakon.com/shimeji/)
- [DPET: Desktop Pet Engine](https://store.steampowered.com/app/1980920/DPET__Desktop_Pet_Engine/)

## License

Warple continues under the repository's MIT license. Original WindowPet code and retained artwork keep their existing attribution. Jo and the Jo pixel artwork are original work by Hyrum Butler.

MIT License Copyright (c) 2023 Seakmeng
