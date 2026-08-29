# Warple project context

Last reviewed against the repository: 2026-08-29

## Product and current experience

Warple is a manually launched, tray-resident desktop companion derived from the
open-source WindowPet project. It runs one selected built-in profile at a time.
Blooky and the original Jo character are registered, and the native tray
`Character` submenu switches between them and remembers the selected built-in
profile.

The application has no settings window, pet catalog, custom-profile editor,
downloaded profiles, external profile storage, or operating-system autostart.
Profiles are versioned declarative data with trusted built-in artwork IDs,
animation definitions, fixed engine roles, attribution, and bounded behavior
parameters. They cannot execute code, name arbitrary paths or URLs, or grant
permissions.

On Windows, the companion can treat one eligible foreground-window top edge as
a temporary one-way platform. When the Explorer desktop is active, it can
notice a nearby desktop item, approach without covering it, inspect it, sit,
and disengage. Native observation reads bounded geometry and Shell metadata; it
does not capture the screen, read file contents, invoke items, or control apps.

## Stack

- React 19 and TypeScript 5 with Vite 8.
- Phaser 3 with embedded Matter for animation, behavior, input, and physics.
- Tauri 2 and Rust edition 2021 for the desktop shell, lifecycle, tray, and
  native observation.
- Node 22 and npm with committed JavaScript and Rust lockfiles.

The application package, crate, product, binary, and bundle identity is
Warple. WindowPet remains only where upstream history, licensing, or retained
artwork attribution requires it.

## Runtime and ownership

```text
Native display geometry and persisted profile ID
  -> hidden Tauri overlay
  -> synchronous built-in profile validation
  -> React and Phaser
  -> generation-bound readiness signal
  -> tray refresh and visible overlay
```

- `src/profiles/` owns schema validation, trusted artwork registration, Blooky
  and Jo data, default and requested selection, and weighted ordinary behavior.
- `src/startup.ts` resolves the requested profile and readiness catalog.
- `src/PhaserWrapper.tsx` passes validated profile and geometry into Phaser.
- `src/scenes/Pets.ts` owns the companion, interactions, contacts, dynamic
  window platform, and movement state.
- `src/scenes/desktopEnvironmentManager.ts` performs bounded low-frequency
  desktop polling and rejects stale observations.
- Tauri owns overlay construction, primary-display resolution, readiness,
  pause/resume/restart/quit, second launch, the tray, profile persistence, and
  native cursor and desktop observation.

The tray contains `Show/Resume`, `Pause`, `Restart`, `Character`, and `Quit`.
Selecting a different character replaces the running overlay through the
existing serialized builder; selecting while paused affects the next resume.
Invalid saved IDs fall back to the validated default and self-heal after
readiness. Restart preserves the selected profile.

## Permissions and local state

The overlay can call only its startup, cursor, desktop-environment, item-detail,
logging, and own-window click-through commands. It has no general filesystem,
shell, network, process, screen-capture, or UI-control access.

Warple persists only the selected built-in profile ID under Tauri's application
configuration directory. It does not read or migrate legacy settings, custom
pet data, or WindowPet storage. Native diagnostics use Tauri's log directory;
actual item values are not logged, and production contains no diagnostics hook.

## Build and current constraints

The release workflow targets Windows, Linux, macOS Intel, and macOS ARM with
pinned toolchains. Windows debug packaging produces the executable and standard
installer formats without launching the app. Cross-platform jobs and non-Windows
runtime behavior still require verification.

Automated coverage includes profile validation and selection, startup and tray
contracts, lifecycle and display failure, desktop-observer boundaries, window
platform policy, icon interaction, Matter contacts and containment, dragging,
climbing, and surface removal. It does not replace live Explorer, rendered
scene, performance, or cross-platform runtime review. Phaser still emits a
large-chunk warning.

Remaining migration priorities are deliberately small and separate:

1. Reassess remaining supporting libraries when useful.
2. Treat TypeScript 7 and Rust edition 2024 as independent compiler migrations.
3. Leave Phaser 4 until behavior and physics coverage is stronger.

Original additional artwork, downloaded profiles, permission UI, richer visual
context, application interaction, and persistent personality remain outside the
current product.

## Documentation roles

- `AGENTS.md`: local operating and security rules.
- `docs/PROJECT_CONTEXT.md`: tracked current architecture and product facts.
- `docs/ACTIVE_PLAN.md`: local approved work currently in progress.
- `README.md`: public product and setup information.
