pub fn list_serial_ports() -> Vec<String> {
    match serialport::available_ports() {
        Ok(ports) => ports.into_iter().map(|p| p.port_name).collect(),
        Err(_) => vec![],
    }
}

pub fn open_serial_port(port_name: &str, baud_rate: u32) -> Result<Box<dyn serialport::SerialPort>, String> {
    match serialport::new(port_name, baud_rate).timeout(std::time::Duration::from_millis(1000)).open() {
        Ok(port) => Ok(port),
        Err(e) => Err(format!("Failed to open port {}: {}", port_name, e)),
    }
}

