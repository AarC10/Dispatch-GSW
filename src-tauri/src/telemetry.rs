pub struct DataPacket {
    pub node_id: u8,
    pub packet_type: u8,
    pub receiver_rssi: i8,
    pub receiver_snr: i8,
    pub latitude: f32,
    pub longitude: f32,
    pub altitude: f32,
    pub fix_status: u8,
    pub satellites_count: u8,
}