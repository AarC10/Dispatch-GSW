use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::{BTreeMap, BTreeSet};

use tauri::Emitter;

use crate::deputy_interpreter::{parse_zephyr_line, RE_HEADER_NODE, RE_HEADER_LICENSED_NOFIX};
use crate::telemetry::{DataPacket, FixStatus};
use serde_json::json;
use serde::Serialize;

#[cfg(windows)]
use winreg::enums::HKEY_LOCAL_MACHINE;
#[cfg(windows)]
use winreg::RegKey;

struct SerialState {
    stop_flag: Option<Arc<AtomicBool>>,
    handle: Option<thread::JoinHandle<()>>,
    writer: Option<Box<dyn serialport::SerialPort>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortOption {
    pub port_name: String,
    pub label: String,
}

static GLOBAL_STATE: OnceLock<Mutex<SerialState>> = OnceLock::new();

fn get_state() -> &'static Mutex<SerialState> {
    GLOBAL_STATE.get_or_init(|| {
        Mutex::new(SerialState {
            stop_flag: None,
            handle: None,
            writer: None,
        })
    })
}

#[cfg(windows)]
fn windows_registry_ports() -> Vec<String> {
    // Fallback source for cases where available_ports misses some COM devices.
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = match hklm.open_subkey("HARDWARE\\DEVICEMAP\\SERIALCOMM") {
        Ok(key) => key,
        Err(_) => return Vec::new(),
    };

    key.enum_values()
        .filter_map(Result::ok)
        .filter_map(|(_, value)| value.to_utf8().ok())
        .collect()
}

#[cfg(not(windows))]
fn windows_registry_ports() -> Vec<String> {
    Vec::new()
}

fn normalize_open_port_name(port_name: &str) -> String {
    #[cfg(windows)]
    {
        let upper = port_name.to_ascii_uppercase();
        if let Some(num_str) = upper.strip_prefix("COM") {
            if let Ok(num) = num_str.parse::<u32>() {
                if num >= 10 && !port_name.starts_with(r"\\.\") {
                    return format!(r"\\.\{}", port_name);
                }
            }
        }
    }

    port_name.to_string()
}

fn normalized_text(value: Option<String>) -> Option<String> {
    value.and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn format_port_label(port_name: &str, port_type: &serialport::SerialPortType) -> String {
    match port_type {
        serialport::SerialPortType::UsbPort(usb) => {
            let product = normalized_text(usb.product.clone());
            let manufacturer = normalized_text(usb.manufacturer.clone());
            match (manufacturer, product) {
                (Some(m), Some(p)) => format!("{} {} ({})", m, p, port_name),
                (None, Some(p)) => format!("{} ({})", p, port_name),
                (Some(m), None) => format!("{} USB Serial ({})", m, port_name),
                (None, None) => format!("USB Serial ({})", port_name),
            }
        }
        serialport::SerialPortType::BluetoothPort => format!("Bluetooth ({})", port_name),
        serialport::SerialPortType::PciPort => format!("PCI Serial ({})", port_name),
        serialport::SerialPortType::Unknown => port_name.to_string(),
    }
}

fn collect_serial_port_options() -> Vec<SerialPortOption> {
    let mut by_port: BTreeMap<String, SerialPortOption> = BTreeMap::new();

    match serialport::available_ports() {
        Ok(ports) => {
            for port in ports {
                let label = format_port_label(&port.port_name, &port.port_type);
                by_port.insert(
                    port.port_name.clone(),
                    SerialPortOption {
                        port_name: port.port_name,
                        label,
                    },
                );
            }
        }
        Err(e) => {
            eprintln!("serialport::available_ports failed: {e}");
        }
    }

    for port_name in windows_registry_ports() {
        by_port
            .entry(port_name.clone())
            .or_insert_with(|| SerialPortOption {
                port_name: port_name.clone(),
                label: port_name,
            });
    }

    by_port.into_values().collect()
}

#[tauri::command]
pub fn list_serial_port_options() -> Result<Vec<SerialPortOption>, String> {
    let options = collect_serial_port_options();
    println!("Found {} serial ports.", options.len());
    Ok(options)
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<String>, String> {
    let mut deduped = BTreeSet::new();
    for option in collect_serial_port_options() {
        deduped.insert(option.port_name);
    }

    let names: Vec<String> = deduped.into_iter().collect();
    println!("Found {} serial ports.", names.len());
    Ok(names)
}

#[tauri::command]
pub fn open_port(app_handle: tauri::AppHandle, port_name: String, baud_rate: u32) -> Result<String, String> {
    let state_mutex = get_state();
    let mut state = state_mutex.lock().map_err(|e| format!("state lock error: {}", e))?;
    if state.handle.is_some() {
        return Err("Port already open".into());
    }

    // Attempt opening port with a short timeout so reads can be interruptible
    let timeout = std::time::Duration::from_millis(500);
    let normalized_port_name = normalize_open_port_name(&port_name);
    let port = match serialport::new(normalized_port_name.as_str(), baud_rate).timeout(timeout).open() {
        Ok(p) => p,
        Err(e) => return Err(format!("Failed to open port: {}", e)),
    };

    let writer = port.try_clone().map_err(|e| format!("Failed to clone port for writing: {}", e))?;

    let stop = Arc::new(AtomicBool::new(false));
    let stop_cloned = stop.clone();
    let app = app_handle.clone();

    let handle = thread::spawn(move || {
        let mut reader = std::io::BufReader::new(port);
        let mut buf = String::new();
        let mut current: Option<DataPacket> = None;

        let emit_packet = |pkt: DataPacket| {
            let _ = app.emit("serial-packet", pkt);
        };

        let merge_packet = |dst: &mut DataPacket, src: DataPacket| {
            if src.node_id.is_some() {
                dst.node_id = src.node_id;
            }
            if src.latitude.is_some() {
                dst.latitude = src.latitude;
            }
            if src.longitude.is_some() {
                dst.longitude = src.longitude;
            }
            if src.satellites_count.is_some() {
                dst.satellites_count = src.satellites_count;
            }
            if src.receiver_rssi.is_some() {
                dst.receiver_rssi = src.receiver_rssi;
            }
            if src.receiver_snr.is_some() {
                dst.receiver_snr = src.receiver_snr;
            }
            if src.callsign.is_some() {
                dst.callsign = src.callsign;
            }
            if !matches!(src.fix_status, FixStatus::Unknown) {
                dst.fix_status = src.fix_status;
            }
            dst.timestamp_ms = src.timestamp_ms;
            dst.raw_lines.extend(src.raw_lines);
        };

        while !stop_cloned.load(Ordering::Relaxed) {
            buf.clear();
            match reader.read_line(&mut buf) {
                Ok(0) => {
                    continue;
                }
                Ok(_) => {
                    let line = buf.trim_end_matches(&['\r', '\n'][..]).to_string();
                    // Emit raw line for debug
                    let _ = app.emit("serial-line", line.clone());

                    let is_packet_start = RE_HEADER_NODE.is_match(&line)
                        || RE_HEADER_LICENSED_NOFIX.is_match(&line);
                    let line_lower = line.to_lowercase();
                    let is_packet_end = line_lower.contains("fix status:")
                        || line_lower.contains("no fix acquired");

                    if is_packet_start {
                        if let Some(prev) = current.take() {
                            emit_packet(prev);
                        }
                    }

                    match parse_zephyr_line(&line) {
                        Ok(pkt_part) => {
                            if let Some(existing) = current.as_mut() {
                                merge_packet(existing, pkt_part);
                            } else {
                                current = Some(pkt_part);
                            }

                            if is_packet_end {
                                if let Some(done) = current.take() {
                                    emit_packet(done);
                                }
                            }
                        }
                        Err(e) => {
                            let _ = app.emit("serial-parse-error", json!({
                                "line": line,
                                "error": format!("{e:?}"),
                            }));
                        }
                    }
                }
                Err(_) => {
                    // Just loop and check stop flag if theres an err
                    continue;
                }
            }
        }

        // Flush pending packets on shutdown
        if let Some(pending) = current.take() {
            emit_packet(pending);
        }
    });

    state.stop_flag = Some(stop);
    state.handle = Some(handle);
    state.writer = Some(writer);

    Ok("ok".into())
}

#[tauri::command]
pub fn close_port() -> Result<String, String> {
    let state_mutex = get_state();
    let mut state = state_mutex.lock().map_err(|e| format!("state lock error: {}", e))?;
    state.writer = None;
    if let Some(stop) = state.stop_flag.take() {
        stop.store(true, Ordering::Relaxed);
    }
    if let Some(handle) = state.handle.take() {
        let _ = handle.join();
    }
    Ok("closed".into())
}

#[tauri::command]
pub fn write_serial(data: String) -> Result<(), String> {
    let state_mutex = get_state();
    let mut state = state_mutex.lock().map_err(|e| format!("state lock error: {}", e))?;
    let writer = state.writer.as_mut().ok_or("Port not open")?;
    let line = format!("{}\n", data);
    writer.write_all(line.as_bytes()).map_err(|e| format!("Write error: {}", e))?;
    Ok(())
}
