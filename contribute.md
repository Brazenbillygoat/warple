# Contributing to Warple

Thank you for contributing. Keep changes focused, preserve upstream attribution, and avoid combining behavior work with dependency or identity migrations.

## Set up a fork

1. Fork `Brazenbillygoat/warple` on GitHub.
2. Clone your fork and enter the repository:

   ```bash
   git clone https://github.com/your-name/warple.git
   cd warple
   ```

3. Add the project repository as an upstream remote:

   ```bash
   git remote add upstream https://github.com/Brazenbillygoat/warple.git
   git fetch upstream
   ```

4. Create a focused branch from current `main`:

   ```bash
   git switch main
   git pull --ff-only upstream main
   git switch -c your-branch-name
   ```

## Development setup

Install the pinned Node, npm, and Rust versions from `.nvmrc`, `package.json`, and `rust-toolchain.toml`. Install the platform prerequisites from the [Tauri 2 guide](https://v2.tauri.app/start/prerequisites/), then install JavaScript dependencies with:

```bash
npm ci
```

Run the desktop application only when interactive review is intended:

```bash
npm run tauri -- dev
```

Use the tray menu's **Quit** action for a graceful shutdown.

## Verification

Run checks in proportion to the change. The complete local set is:

```bash
npm test -- --run
npm run build
npm audit
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --debug
```

The last command builds the application and installer artifacts without launching Warple.

## Submit the change

Commit only the intended files, push your branch to your fork, and open a pull request against `main`. Describe the behavior changed, automated checks run, and any manual desktop review still required.
