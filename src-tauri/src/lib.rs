mod telemetry;
mod serial;
mod deputy_interpreter;
mod export;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![serial::list_serial_ports, serial::open_port, serial::close_port, export::export_packets_csv])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
