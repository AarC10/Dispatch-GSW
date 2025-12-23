use crate::telemetry::{DataPacket, FixStatus};
use regex::Regex;
use lazy_static::lazy_static;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub enum ParseError {
    NoMatch,
    InvalidNumber(String),
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn parse_zephyr_line(line: &str) -> Result<DataPacket, ParseError> {
    lazy_static! {
        static ref RE_NODE: Regex = Regex::new(r"(?i)node\s*id[:=]?\s*(\d+)").unwrap();
        static ref RE_LAT: Regex = Regex::new(r"(?i)lat(?:itude)?[:=]?\s*(-?\d+\.\d+)").unwrap();
        static ref RE_LON: Regex = Regex::new(r"(?i)lon(?:gitude)?[:=]?\s*(-?\d+\.\d+)").unwrap();
        static ref RE_RSSI: Regex = Regex::new(r"(?i)rssi[:=]?\s*(-?\d+)").unwrap();
        static ref RE_SNR: Regex = Regex::new(r"(?i)snr[:=]?\s*(-?\d+)").unwrap();
        static ref RE_SATS: Regex = Regex::new(r"(?i)sats?(?:ellites)?[:=]?\s*(\d+)").unwrap();
        static ref RE_FIX: Regex = Regex::new(r"(?i)fix\s*status[:=]?\s*([A-Z]+)").unwrap();
        static ref RE_NOFIX: Regex = Regex::new(r"(?i)no\s*fix").unwrap();
    }

    let mut pkt = DataPacket {
        timestamp_ms: now_ms(),
        raw_lines: vec![line.to_string()],
        ..Default::default()
    };

    if let Some(cap) = RE_NODE.captures(line) {
        pkt.node_id = cap.get(1).and_then(|m| m.as_str().parse::<u8>().ok());
    }
    if let Some(cap) = RE_LAT.captures(line) {
        pkt.latitude = cap.get(1).and_then(|m| m.as_str().parse::<f32>().ok());
    }
    if let Some(cap) = RE_LON.captures(line) {
        pkt.longitude = cap.get(1).and_then(|m| m.as_str().parse::<f32>().ok());
    }
    if let Some(cap) = RE_RSSI.captures(line) {
        pkt.receiver_rssi = cap.get(1).and_then(|m| m.as_str().parse::<i16>().ok());
    }
    if let Some(cap) = RE_SNR.captures(line) {
        pkt.receiver_snr = cap.get(1).and_then(|m| m.as_str().parse::<i8>().ok());
    }
    if let Some(cap) = RE_SATS.captures(line) {
        pkt.satellites_count = cap.get(1).and_then(|m| m.as_str().parse::<u8>().ok());
    }

    // explicit status token first, else "NO FIX" substring
    if let Some(cap) = RE_FIX.captures(line) {
        pkt.fix_status = match cap.get(1).map(|m| m.as_str().to_uppercase()) {
            Some(s) if s.contains("NO") => FixStatus::NoFix,
            Some(s) if s.contains("DIFF") => FixStatus::Diff,
            Some(s) if s.contains("EST") => FixStatus::Est,
            Some(s) if s.contains("FIX") => FixStatus::Fix,
            _ => FixStatus::Unknown,
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
        || !matches!(pkt.fix_status, FixStatus::Unknown);

    if meaningful {
        Ok(pkt)
    } else {
        Err(ParseError::NoMatch)
    }
}
