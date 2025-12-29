import { useCallback, useEffect, useRef } from "react";

export const DEMO_PORT = "URRG DEMO";
// URRG Landing Area 42.704298, -77.187240
const DEMO_BASE_LAT = 42.704298;
const DEMO_BASE_LON = -77.18724;
const DEMO_TRACKER_IDS = ["RISK", "OTIS", "OMEN", "KONG"] as const;
const DEMO_SCHEDULE = [...DEMO_TRACKER_IDS, "VOID"] as const;
const DEMO_SLOT_MS = 1000;
const DEMO_MAX_RADIUS = 0.0045; // wander within ~500 m
const DEMO_STEP = 0.00035; // jitter

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

function randomFloat(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export function useDemoSimulation(processPacket: (packet: DemoPacket) => void) {
  const demoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoSlotRef = useRef(0);
  const positionsRef = useRef<Record<string, { lat: number; lon: number }>>({});

  const stopDemo = useCallback(() => {
    if (demoTimerRef.current) {
      clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
    }
  }, []);

  const emitDemoPackets = useCallback(() => {
    const now = Date.now();
    const slotIdx = demoSlotRef.current % DEMO_SCHEDULE.length;
    const nodeId = DEMO_SCHEDULE[slotIdx];
    const baseRssi = randomInt(-80, -40);
    const baseSnr = randomInt(-5, 20);

    if (nodeId !== "VOID") {
      const current = positionsRef.current[nodeId] ?? {
        lat: DEMO_BASE_LAT + randomFloat(-0.005, 0.005),
        lon: DEMO_BASE_LON + randomFloat(-0.005, 0.005),
      };

      let nextLat = current.lat + randomFloat(-DEMO_STEP, DEMO_STEP);
      let nextLon = current.lon + randomFloat(-DEMO_STEP, DEMO_STEP);

      // Keep wander bounded near the base
      const dx = nextLat - DEMO_BASE_LAT;
      const dy = nextLon - DEMO_BASE_LON;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > DEMO_MAX_RADIUS) {
        const scale = DEMO_MAX_RADIUS / dist;
        nextLat = DEMO_BASE_LAT + dx * scale;
        nextLon = DEMO_BASE_LON + dy * scale;
      }

      positionsRef.current[nodeId] = { lat: nextLat, lon: nextLon };

      processPacket({
        nodeId,
        lat: nextLat,
        lon: nextLon,
        fixStatus: "FIX",
        sats: randomInt(5, 14),
        rssi: baseRssi + randomInt(-20, 20),
        snr: baseSnr + randomInt(-5, 5),
        ts: now,
      });
    } else {
      processPacket({
        nodeId: "VOID",
        fixStatus: "NOFIX",
        rssi: baseRssi + randomInt(-20, 20),
        snr: baseSnr + randomInt(-5, 5),
        ts: now,
      });
    }

    demoSlotRef.current = (slotIdx + 1) % DEMO_SCHEDULE.length;
  }, [processPacket]);

  const startDemo = useCallback(() => {
    stopDemo();
    positionsRef.current = {};
    demoSlotRef.current = 0;
    emitDemoPackets();
    demoTimerRef.current = setInterval(emitDemoPackets, DEMO_SLOT_MS);
  }, [emitDemoPackets, stopDemo]);

  useEffect(() => () => stopDemo(), [stopDemo]);

  return { startDemo, stopDemo };
}
