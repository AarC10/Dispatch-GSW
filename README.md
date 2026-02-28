# Dispatch

Ground station application for Wild West Rocketry LoRa-based tracker nodes. Receives telemetry over a USB serial connection and displays live GPS positions, signal quality metrics, and a scrolling packet log. Also supports pushing configuration to connected devices.

## Requirements

- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install) (for Tauri)
- Tauri prerequisites for your platform: https://tauri.app/start/prerequisites/

## Development

```bash
pnpm install
pnpm tauri dev
```

## Building

```bash
pnpm tauri build
```

Distributable bundles (AppImage, .deb, .dmg, .msi, etc.) are output to `src-tauri/target/release/bundle/`.

## Tech Stack

- [Tauri v2](https://tauri.app/) — desktop shell
- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) — UI
- [Vite](https://vite.dev/) — frontend build
- [Leaflet](https://leafletjs.com/) / [react-leaflet](https://react-leaflet.js.org/) — mapping

## Usage

See [docs/GUIDE.md](docs/GUIDE.md) for a full user guide.