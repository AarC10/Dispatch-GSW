# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Dispatch** is a cross-platform Tauri desktop application serving as a ground station for Wild West Rocketry's LoRa-based devices — including both **tracker nodes** and **flight computers**. It displays real-time GPS telemetry on an interactive map, supports serial-based configuration of connected boards, and exports data to CSV.

## Commands

```bash
# Start development (Vite dev server + Tauri hot reload)
pnpm tauri dev

# Build distributable bundles (AppImage, .deb, .dmg, .msi)
pnpm tauri build

# Frontend only (port 1420)
pnpm dev
pnpm build
```

Uses **pnpm** (not npm/yarn). No test suite exists currently.

## Architecture

### Tech Stack
- **Frontend**: React 19 + TypeScript + Vite (port 1420) + Leaflet maps
- **Backend**: Rust + Tauri v2 + `serialport` crate
- **IPC**: Tauri `invoke()` commands and `emit()`/`listen()` events

### Frontend ↔ Backend Communication
- Frontend calls Rust via `invoke("command_name", payload)` — e.g., `invoke("open_port", {portName, baudRate})`
- Backend streams data back via events — `emit("serial-packet", DataPacket)` and `emit("serial-line", string)`
- Frontend subscribes with `listen<T>("event-name", handler)` from `@tauri-apps/api`

### Serial Telemetry Pipeline
```
Physical Serial Port
  → serialport crate reads lines (BufReader)
  → deputy_interpreter.rs: regex patterns match each line
  → Partial packets merged via merge_packet() logic
  → emit("serial-packet") when packet is complete
  → Frontend updates map/tracker list
```

Multi-line packets are assembled in `serial.rs`: a new packet header triggers emission of the previous packet; a fix-status line finalizes the current one.

Two device header formats are supported:
- Unlicensed: `Node N:`
- Licensed (amateur radio): `CALLSIGN-N:`

### Key Files
| File | Purpose |
|------|---------|
| `src/App.tsx` | Root component: tabs, connection controls, port/baud selection |
| `src/TrackingTab.tsx` | Map (Leaflet) + tracker cards + packet log |
| `src/ConfigTab.tsx` | Device configuration UI (probe, edit, send fields) — works with both trackers and flight computers |
| `src/types.ts` | Shared TypeScript interfaces (`TelemetryPacket`, `Tracker`, etc.) |
| `src/demoSimulation.tsx` | Hardware-free demo mode with 5 simulated nodes |
| `src-tauri/src/lib.rs` | Tauri command registration and plugin init |
| `src-tauri/src/serial.rs` | Serial port open/close/write, background read thread |
| `src-tauri/src/deputy_interpreter.rs` | Regex-based multi-line packet parsing |
| `src-tauri/src/telemetry.rs` | `DataPacket` struct and `FixStatus` enum |
| `src-tauri/src/export.rs` | CSV export via `invoke("export_packets_csv")` |

### State Management
- **Frontend**: React hooks (`useState`, `useCallback`, `useEffect`) — no external state library
- **Backend**: `OnceLock<Mutex<SerialState>>` global for thread-safe serial port access

### Demo Mode
`demoSimulation.tsx` generates 5 nodes (RISK, OTIS, OMEN, KONG, VOID) with Brownian-motion trajectories near URRG landing area (42.704298, -77.18724), emitting packets at ~1 Hz per node. Useful for UI work without hardware.

## Build & Release

CI/CD via `.github/workflows/publish.yml` builds for macOS (ARM64 + x86_64), Linux (Ubuntu 24.04), and Windows on every push to `main`. The Tauri action auto-creates a GitHub Release with platform installers.

App version is set in `src-tauri/tauri.conf.json` → `version`.