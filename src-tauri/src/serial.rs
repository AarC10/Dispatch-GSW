use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::Emitter;

use crate::deputy_interpreter::{parse_zephyr_line};
use crate::telemetry::{DataPacket, FixStatus};
use serde_json::json;

struct SerialState {
    stop_flag: Option<Arc<AtomicBool>>,
    handle: Option<thread::JoinHandle<()>>,
}

static GLOBAL_STATE: OnceLock<Mutex<SerialState>> = OnceLock::new();

fn get_state() -> &'static Mutex<SerialState> {
    GLOBAL_STATE.get_or_init(|| {
        Mutex::new(SerialState {
            stop_flag: None,
            handle: None,
        })
    })
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<String>, String> {
    match serialport::available_ports() {
        Ok(ports) => {
            println!("Found {} serial ports.", ports.len());
            let names = ports.into_iter().map(|p| p.port_name).collect();
            Ok(names)
        }
        Err(e) => Err(format!("Failed to list serial ports: {}", e)),
    }
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
    let port = match serialport::new(port_name.as_str(), baud_rate).timeout(timeout).open() {
        Ok(p) => p,
        Err(e) => return Err(format!("Failed to open port: {}", e)),
    };

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

                    let is_packet_start = line.to_lowercase().contains("packet received");
                    let is_fix_line = line.to_lowercase().contains("fix status") || line.to_lowercase().contains("no fix");

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

                            if is_fix_line {
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

    Ok("ok".into())
}

#[tauri::command]
pub fn close_port() -> Result<String, String> {
    let state_mutex = get_state();
    let mut state = state_mutex.lock().map_err(|e| format!("state lock error: {}", e))?;
    if let Some(stop) = state.stop_flag.take() {
        stop.store(true, Ordering::Relaxed);
    }
    if let Some(handle) = state.handle.take() {
        let _ = handle.join();
    }
    Ok("closed".into())
}
