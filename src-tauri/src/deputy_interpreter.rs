use crate::telemetry::{DataPacket, FixStatus};
use regex::Regex;
use lazy_static::lazy_static;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub enum ParseError {
    NoMatch,
}

lazy_static! {
    // Probably shouldnt all unwrap but fiwb

    // Packet header - unlicensed or licensed fix packet
    // Matches: "Node 1: (13 bytes | -80 dBm | 7 dB):"
    pub static ref RE_HEADER_NODE: Regex = Regex::new(
        r"(?i)node\s+(\d+):\s*\(\d+\s*bytes\s*\|\s*(-?\d+)\s*dBm\s*\|\s*(-?\d+)\s*dB"
    ).unwrap();

    // Packet header - licensed no-fix packet
    // Matches: "KD2YIE-1: (13 bytes | -80 dBm | 7 dB):"
    pub static ref RE_HEADER_LICENSED_NOFIX: Regex = Regex::new(
        r"^([A-Z0-9/\-]{3,12})-(\d+):\s*\(\d+\s*bytes\s*\|\s*(-?\d+)\s*dBm\s*\|\s*(-?\d+)\s*dB"
    ).unwrap();

    pub static ref RE_LAT: Regex = Regex::new(r"(?i)latitude:\s*(-?\d+\.\d+)").unwrap();
    pub static ref RE_LON: Regex = Regex::new(r"(?i)longitude:\s*(-?\d+\.\d+)").unwrap();
    pub static ref RE_SATS: Regex = Regex::new(r"(?i)satellites count:\s*(\d+)").unwrap();
    pub static ref RE_FIX: Regex = Regex::new(r"(?i)fix status:\s*(\S+(?:\s+\S+)?)").unwrap();
    pub static ref RE_NOFIX: Regex = Regex::new(r"(?i)no fix acquired").unwrap();
    pub static ref RE_CALLSIGN: Regex = Regex::new(r"(?i)callsign:\s*([A-Z0-9/\-]{3,12})").unwrap();
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn parse_zephyr_line(line: &str) -> Result<DataPacket, ParseError> {
    let mut pkt = DataPacket {
        timestamp_ms: now_ms(),
        raw_lines: vec![line.to_string()],
        ..Default::default()
    };

    if let Some(cap) = RE_HEADER_NODE.captures(line) {
        pkt.node_id = cap.get(1).and_then(|m| m.as_str().parse::<u8>().ok());
        pkt.receiver_rssi = cap.get(2).and_then(|m| m.as_str().parse::<i16>().ok());
        pkt.receiver_snr = cap.get(3).and_then(|m| m.as_str().parse::<i8>().ok());
    } else if let Some(cap) = RE_HEADER_LICENSED_NOFIX.captures(line) {
        pkt.callsign = cap.get(1).map(|m| m.as_str().to_string());
        pkt.node_id = cap.get(2).and_then(|m| m.as_str().parse::<u8>().ok());
        pkt.receiver_rssi = cap.get(3).and_then(|m| m.as_str().parse::<i16>().ok());
        pkt.receiver_snr = cap.get(4).and_then(|m| m.as_str().parse::<i8>().ok());
    }

    if let Some(cap) = RE_LAT.captures(line) {
        pkt.latitude = cap.get(1).and_then(|m| m.as_str().parse::<f32>().ok());
    }
    if let Some(cap) = RE_LON.captures(line) {
        pkt.longitude = cap.get(1).and_then(|m| m.as_str().parse::<f32>().ok());
    }
    if let Some(cap) = RE_SATS.captures(line) {
        pkt.satellites_count = cap.get(1).and_then(|m| m.as_str().parse::<u8>().ok());
    }
    if let Some(cap) = RE_CALLSIGN.captures(line) {
        pkt.callsign = cap.get(1).map(|m| m.as_str().to_string());
    }

    if let Some(cap) = RE_FIX.captures(line) {
        let val = cap.get(1).map(|m| m.as_str().to_uppercase()).unwrap_or_default();
        pkt.fix_status = if val.contains("NO") {
            FixStatus::NoFix
        } else if val.contains("DIFF") {
            FixStatus::Diff
        } else if val.contains("EST") {
            FixStatus::Est
        } else if val.contains("FIX") {
            FixStatus::Fix
        } else {
            FixStatus::Unknown
        };
    } else if RE_NOFIX.is_match(line) {
        pkt.fix_status = FixStatus::NoFix;
    }

    let meaningful = pkt.node_id.is_some()
        || pkt.latitude.is_some()
        || pkt.longitude.is_some()
        || pkt.receiver_rssi.is_some()
        || pkt.receiver_snr.is_some()
        || pkt.satellites_count.is_some()
        || pkt.callsign.is_some()
        || !matches!(pkt.fix_status, FixStatus::Unknown);

    if meaningful {
        Ok(pkt)
    } else {
        Err(ParseError::NoMatch)
    }
}
