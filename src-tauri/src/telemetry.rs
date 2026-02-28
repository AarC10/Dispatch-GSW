use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FixStatus {
    NoFix,
    Fix,
    Diff,
    Est,
    Unknown,
}

impl Default for FixStatus {
    fn default() -> Self {
        FixStatus::Unknown
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DataPacket {
    pub node_id: Option<u8>,
    pub latitude: Option<f32>,
    pub longitude: Option<f32>,
    pub satellites_count: Option<u8>,
    pub fix_status: FixStatus,
    pub receiver_rssi: Option<i16>,
    pub receiver_snr: Option<i8>,
    pub callsign: Option<String>,
    pub timestamp_ms: i64,
    pub raw_lines: Vec<String>,
}