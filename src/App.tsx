import { useCallback, useEffect, useRef, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { DEMO_PORT, useDemoSimulation } from "./demoSimulation";
import type { Tracker, TelemetryPacket } from "./types";
import { colorForIndex, fixFromString } from "./utils";
import { TrackingTab } from "./TrackingTab";
import { ConfigTab } from "./ConfigTab";

function App() {
  const [activeTab, setActiveTab] = useState<"tracking" | "config">("tracking");

  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [baud, setBaud] = useState(9600);
  const [connected, setConnected] = useState(false);

  const [trackers, setTrackers] = useState<Record<string, Tracker>>({});
  const [packets, setPackets] = useState<TelemetryPacket[]>([]);
  const [trackerColors, setTrackerColors] = useState<Record<string, string>>({});

  const clearGenRef = useRef(0);

  const processPacket = useCallback((packet: TelemetryPacket) => {
    const gen = clearGenRef.current;
    setTrackerColors((prev) => {
      if (prev[packet.nodeId]) return prev;
      const nextIdx = Object.keys(prev).length;
      return { ...prev, [packet.nodeId]: colorForIndex(nextIdx) };
    });
    setPackets((prev) => {
      if (clearGenRef.current !== gen) return prev;
      return [packet, ...prev].slice(0, 500);
    });
    setTrackers((prev) => {
      const next = { ...prev } as Record<string, Tracker>;
      const tracker = next[packet.nodeId] ?? { nodeId: packet.nodeId, points: [] };
      if (packet.lat !== undefined && packet.lon !== undefined) {
        tracker.points = [...tracker.points, { lat: packet.lat, lon: packet.lon, ts: packet.ts }].slice(-200);
      }
      tracker.latest = packet;
      next[packet.nodeId] = tracker;
      return next;
    });
  }, []);

  const { startDemo, stopDemo } = useDemoSimulation(processPacket);

  function clearPackets() {
    clearGenRef.current += 1;
    setPackets([]);
  }


  async function refreshPorts() {
    try {
      const list = await invoke<string[]>("list_serial_ports");
      setPorts(list);
    } catch (e) {
      console.error(e);
    }
  }

  async function connect() {
    if (!selectedPort) return;
    if (selectedPort === DEMO_PORT) {
      startDemo();
      setConnected(true);
      return;
    }
    try {
      await invoke("open_port", { portName: selectedPort, baudRate: baud });
      setConnected(true);
    } catch (e) {
      console.error("open_port failed", e);
      setConnected(false);
    }
  }

  async function disconnect() {
    stopDemo();
    if (selectedPort !== DEMO_PORT) {
      try {
        await invoke("close_port");
      } catch (e) {
        console.warn("close_port failed", e);
      }
    }
    setConnected(false);
  }

  useEffect(() => {
    refreshPorts().then(r => r);
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    (async () => {
      try {
        unlisten = await listen<any>("serial-packet", (event) => {
          const pktRaw = event.payload;
          if (!pktRaw) return;
          const pkt: TelemetryPacket = {
            nodeId: String(pktRaw.node_id ?? "unknown"),
            lat: pktRaw.latitude ?? undefined,
            lon: pktRaw.longitude ?? undefined,
            rssi: pktRaw.receiver_rssi ?? undefined,
            snr: pktRaw.receiver_snr ?? undefined,
            fixStatus: fixFromString(pktRaw.fix_status),
            sats: pktRaw.satellites_count ?? undefined,
            ts: pktRaw.timestamp_ms ?? Date.now(),
            raw: (pktRaw.raw_lines?.join("\n")) || undefined,
          };
          processPacket(pkt);
        });
      } catch (e) {
        console.warn("Could not attach serial listener", e);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [processPacket]);


  return (
    <main className="layout">
      <header className="toolbar">
        <div className="toolbar-left">
          <h2>Dispatch</h2>
          <nav className="tabs-inline">
            <button
              className={`tab ${activeTab === "tracking" ? "active" : ""}`}
              onClick={() => setActiveTab("tracking")}
            >
              Tracking
            </button>
            <button
              className={`tab ${activeTab === "config" ? "active" : ""}`}
              onClick={() => setActiveTab("config")}
            >
              Config
            </button>
          </nav>
        </div>
        <div className="toolbar-right">
          <div className="controls-row">
            <div className="field-inline">
              <label>Port</label>
              <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
                <option value="">Select</option>
                <option value={DEMO_PORT}>URRG Demo Simulation</option>
                {ports.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button className="icon-button" title="Refresh ports" onClick={refreshPorts}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M21 12a9 9 0 10-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>

            <div className="field-inline">
              <label>Baud</label>
              <input
                type="number"
                value={baud}
                onChange={(e) => setBaud(parseInt(e.target.value || "0", 10))}
                min={1200}
                step={1200}
              />
            </div>


            {connected ? (
                <button onClick={disconnect} className="ghost">
                  Disconnect
                </button>
            ) : (
                <button onClick={connect} disabled={!selectedPort} className="primary">
                  Connect
                </button>
            )}
          </div>
        </div>
      </header>

      {activeTab === "tracking" && (
        <TrackingTab
          trackers={trackers}
          packets={packets}
          trackerColors={trackerColors}
          onClearPackets={clearPackets}
        />
      )}

      {activeTab === "config" && <ConfigTab />}
    </main>
  );
}

export default App;
