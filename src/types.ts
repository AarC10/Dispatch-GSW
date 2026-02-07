export type FixStatus = "NOFIX" | "FIX" | "DIFF" | "EST" | "UNKNOWN";

export type TelemetryPacket = {
  nodeId: string;
  lat?: number;
  lon?: number;
  rssi?: number;
  snr?: number;
  fixStatus?: FixStatus;
  sats?: number;
  ts: number;
  raw?: string;
};

export type Tracker = {
  nodeId: string;
  points: { lat: number; lon: number; ts: number }[];
  latest?: TelemetryPacket;
};
