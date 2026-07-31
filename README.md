<div align="center">
    <img width="180" src="./public/media/icon.png" alt="Warple">
    <h1 align="center">Warple</h1>
    <p align="center">
        A little desktop companion that wanders, rests, climbs, and hangs out without trying to become your full-time job.
    </p>
    <img src="https://img.shields.io/badge/Windows-0078D6?style=flat&logo=windows&logoColor=white" alt="Windows">
    <img src="https://img.shields.io/badge/macOS-adb8c5?style=flat&logo=macos&logoColor=white" alt="macOS">
    <img src="https://img.shields.io/badge/Linux-1793D1?style=flat&logo=linux&logoColor=white" alt="Linux">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license">
</div>

## ✨ What is Warple?

Warple is a transparent desktop-pet overlay built with Tauri, React, and Phaser. The current app can run multiple animated pets, load custom sprite sheets, react to the cursor, and stay out of the way when it is not being touched.

The longer-term goal is a subtle creature with a recognizable personality rather than a random animation machine or a notification system with legs. We are building toward that carefully. AI features, activity tracking, persistent behavioral memory, and broad computer access are not part of the current app. Not sure they will be but I have an eye toward them.

Warple began as a fork of [WindowPet](https://github.com/SeakMengs/WindowPet) by [SeakMengs](https://github.com/SeakMengs). WindowPet provided the original application, pet engine, settings interface, and bundled pet collection. That work remains credited and is being phased into Warple over time instead of being passed off as original work.

## ✨ Features

- Transparent, click-through desktop overlay
- Multiple pets on screen at once
- 50 bundled pet configurations
- Custom PNG sprite-sheet import
- Configurable animation states such as idle, walk, sit, jump, fall, climb, crawl, and drag
- Dragging, climbing, bouncing, and edge-aware movement when supported by the pet
- Pet scaling, interaction, climbing, taskbar, theme, and language settings
- System-tray controls for showing, pausing, restarting, opening settings, and quitting
- Local-only pet and settings data
- Narrow Tauri permissions for the pet overlay and settings window

Bundled character artwork comes from the original WindowPet collection and its listed creators. Individual pet configuration files preserve available source and creator credits. It is not original Warple artwork.

Auto-start and automatic updates were removed during the Tauri 2 migration. If they return, they will be rebuilt deliberately rather than quietly regaining broad access.

## ✨ Development

### Requirements

- Node.js `22.23.0`
- npm `10.9.x`
- Rust `1.97.1`
- The platform prerequisites from the [Tauri 2 guide](https://v2.tauri.app/start/prerequisites/)

The Node and Rust versions are pinned in the repository.

### Install

```bash
npm ci
```

### Run

```bash
npm run tauri -- dev
```

Run commands from the repository root. Use the tray menu's **Quit** action for a graceful shutdown. `Ctrl+C` also stops development, but Windows may print forced-exit noise while closing the webview.

### Test and build

```bash
npm test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri -- build --debug
```

The last command builds the desktop application and installers without launching Warple.

## ✨ How it fits together

```text
Saved pet and settings JSON
        ↓
React Query loads local data
        ↓
Zustand holds live settings and pet state
        ↓
PhaserWrapper passes pet configs into Phaser
        ↓
Pets scene creates animations, physics, and behavior
        ↓
Transparent Tauri desktop window
```

- React and Mantine own the settings interface.
- Zustand owns live frontend state.
- Phaser owns sprites, animation, input hit testing, physics, and pet behavior.
- Tauri owns windows, the tray, capabilities, and the native command boundary.
- Rust owns validated local configuration paths, native cursor position, and desktop lifecycle work.

`src/scenes/Pets.ts` runs the real desktop population. `src/scenes/Pet.ts` is the single-pet preview used by settings.

## ✨ Local data and safety

Warple stores its data in the operating system's application-config directory under the existing `WindowPet` folder. That internal name is intentionally being phased out gradually.

The native layer accepts only:

- `settings.json`, `pets.json`, and `pet_linker.json`
- `custom-pets/*.json`
- `assets/*.png`

The pet overlay can read configuration and cursor position. The settings window can manage those validated paths and import a PNG explicitly selected by the user. It does not currently have general filesystem, shell, screen-capture, or UI-control access.

## ✨ Platform status

Windows development, tests, and installer builds have been verified locally. The release workflow is configured for Windows, Intel and Apple Silicon macOS, and Linux, but those GitHub release jobs have not yet been exercised in this fork.

## ✨ Inspiration

- [WindowPet](https://github.com/SeakMengs/WindowPet)
- [vscode-pets](https://marketplace.visualstudio.com/items?itemName=tonybaloney.vscode-pets)
- [Shimeji-ee Desktop Pet](https://kilkakon.com/shimeji/)
- [DPET: Desktop Pet Engine](https://store.steampowered.com/app/1980920/DPET__Desktop_Pet_Engine/)

## ✨ License

Warple continues under the repository's MIT license. Original WindowPet code and assets retain their existing copyright and attribution.

MIT License Copyright (c) 2023 Seakmeng
