import { useCallback, useEffect, useRef } from "react";

export const DEMO_PORT = "URRG DEMO";
// URRG Landing Area 42.705122, -77.190666
const DEMO_BASE_LAT = 42.705122;
const DEMO_BASE_LON = -77.190666;
const DEMO_TRACKER_CONFIGS = [
  { nodeId: "RISK", offset: 0, radius: 0.0009 },
  { nodeId: "OTIS", offset: Math.PI / 2, radius: 0.00075 },
  { nodeId: "OMEN", offset: Math.PI, radius: 0.0006 },
  { nodeId: "KONG", offset: (3 * Math.PI) / 2, radius: 0.00085 },
] as const;
const DEMO_SCHEDULE = ["RISK", "OTIS", "OMEN", "KONG", "VOID"] as const;
const DEMO_SLOT_MS = 1000;

export type DemoPacket = {
  nodeId: string;
  lat?: number;
  lon?: number;
  rssi?: number;
  snr?: number;
  fixStatus?: "NOFIX" | "FIX" | "DIFF" | "EST" | "UNKNOWN";
  sats?: number;
  ts: number;
};

function randomInt(min: number, max: number) {
  const minCeil = Math.ceil(min);
  const maxFloor = Math.floor(max);
  return Math.floor(Math.random() * (maxFloor - minCeil + 1)) + minCeil;
}

export function useDemoSimulation(processPacket: (packet: DemoPacket) => void) {
  const demoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoPhaseRef = useRef(0);
  const demoSlotRef = useRef(0);

  const stopDemo = useCallback(() => {
    if (demoTimerRef.current) {
      clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
    }
  }, []);

  const emitDemoPackets = useCallback(() => {
    const now = Date.now();
    const phase = demoPhaseRef.current;
    const slotIdx = demoSlotRef.current % DEMO_SCHEDULE.length;
    const nodeId = DEMO_SCHEDULE[slotIdx];
    const config = DEMO_TRACKER_CONFIGS.find((c) => c.nodeId === nodeId);

    if (config) {
      const angle = phase + config.offset;
      const radius = config.radius + Math.sin(phase + slotIdx * 0.7) * 0.00015;
      const baseRssi = randomInt(-80, -40);
      const baseSnr = randomInt(-5, 20);

      processPacket({
        nodeId: config.nodeId,
        lat: DEMO_BASE_LAT + radius * Math.cos(angle),
        lon: DEMO_BASE_LON + radius * Math.sin(angle),
        fixStatus: "FIX",
        sats: 8 + slotIdx,
        rssi: baseRssi + randomInt(-20, 20),
        snr: baseSnr + randomInt(-5, 5),
        ts: now,
      });
    } else if (nodeId === "VOID") {
      processPacket({
        nodeId: "VOID",
        fixStatus: "NOFIX",
        ts: now,
      });
    }

    demoSlotRef.current = (slotIdx + 1) % DEMO_SCHEDULE.length;
    demoPhaseRef.current = (phase + Math.PI / 24) % (Math.PI * 2);
  }, [processPacket]);

  const startDemo = useCallback(() => {
    stopDemo();
    demoPhaseRef.current = 0;
    demoSlotRef.current = 0;
    emitDemoPackets();
    demoTimerRef.current = setInterval(emitDemoPackets, DEMO_SLOT_MS);
  }, [emitDemoPackets, stopDemo]);

  useEffect(() => () => stopDemo(), [stopDemo]);

  return { startDemo, stopDemo };
}

