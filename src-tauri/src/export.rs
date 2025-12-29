use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use tauri::AppHandle;
use dirs::download_dir;

#[derive(Debug, Deserialize)]
pub struct FrontendPacket {
    pub node_id: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub rssi: Option<f64>,
    pub snr: Option<f64>,
    pub fix_status: Option<String>,
    pub sats: Option<u64>,
    pub ts: i64,
}

#[derive(serde::Serialize)]
struct CsvRow<'a> {
    #[serde(rename = "Time")]
    time: &'a str,
    #[serde(rename = "Node")]
    node: &'a str,
    #[serde(rename = "Latitude")]
    lat: String,
    #[serde(rename = "Longitude")]
    lon: String,
    #[serde(rename = "RSSI (dBm)")]
    rssi: String,
    #[serde(rename = "SNR (dB)")]
    snr: String,
    #[serde(rename = "Fix")]
    fix: String,
    #[serde(rename = "Satellites in View")]
    sats: String,
}

#[tauri::command]
pub async fn export_packets_csv(_app: AppHandle, packets: Vec<FrontendPacket>, path: Option<String>) -> Result<String, String> {
    if packets.is_empty() {
        return Err("No packets to export".into());
    }

    let default_name = format!("packets-{}.csv", Utc::now().format("%Y%m%dT%H%M%S"));
    let mut base = download_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or(PathBuf::from(".")));
    base.push(&default_name);

    let target = path.map(PathBuf::from).unwrap_or(base);

    write_csv(&target, &packets).map_err(|e| format!("Failed to write CSV: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

fn write_csv(path: &PathBuf, packets: &[FrontendPacket]) -> Result<(), Box<dyn std::error::Error>> {
    let file = File::create(path)?;
    let mut writer = csv::Writer::from_writer(BufWriter::new(file));

    for pkt in packets.iter() {
        let ts = DateTime::from_timestamp_millis(pkt.ts)
            .ok_or_else(|| format!("invalid timestamp: {}", pkt.ts))?;
        let row = CsvRow {
            time: &ts.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            node: &pkt.node_id,
            lat: pkt.lat.map(|v| format!("{v:.6}")) .unwrap_or_default(),
            lon: pkt.lon.map(|v| format!("{v:.6}")) .unwrap_or_default(),
            rssi: pkt.rssi.map(|v| format!("{v}")) .unwrap_or_default(),
            snr: pkt.snr.map(|v| format!("{v}")) .unwrap_or_default(),
            fix: pkt.fix_status.clone().unwrap_or_default(),
            sats: pkt.sats.map(|v| v.to_string()).unwrap_or_default(),
        };
        writer.serialize(row)?;
    }

    writer.flush()?;
    writer.into_inner()?.flush()?;
    Ok(())
}
