mod telemetry;
mod serial;
mod deputy_interpreter;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![serial::list_serial_ports, serial::open_port, serial::close_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
