import {useCallback, useEffect, useMemo, useState, type DragEvent} from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap, } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
import { DEMO_PORT, useDemoSimulation } from "./demoSimulation";

type FixStatus = "NOFIX" | "FIX" | "DIFF" | "EST" | "UNKNOWN";

type TelemetryPacket = {
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

type Tracker = {
  nodeId: string;
  points: { lat: number; lon: number; ts: number }[];
  latest?: TelemetryPacket;
};

function colorForIndex(idx: number) {
  const palette = [
    "#e41a1c",
    "#377eb8",
    "#4daf4a",
    "#984ea3",
    "#ff7f00",
    "#ffff33",
    "#a65628",
    "#f781bf",
    "#999999",
  ];
  if (idx < palette.length) return palette[idx];
  const hue = (idx * 137.508) % 360; // golden angle to spread hues
  return `hsl(${hue}, 70%, 50%)`;
}

function fixFromString(s?: string): FixStatus | undefined {
  if (!s) return undefined;
  const upper = s.toUpperCase();
  if (upper.includes("NO")) return "NOFIX";
  if (upper.includes("DIFF")) return "DIFF";
  if (upper.includes("EST")) return "EST";
  if (upper.includes("FIX")) return "FIX";
  return "UNKNOWN";
}

function ZoomToLatest({ trackers }: { trackers: Record<string, Tracker> }) {
  const map = useMap();
  useEffect(() => {
    const all = Object.values(trackers)
      .map((tracker) => tracker.latest)
      .filter((packet): packet is TelemetryPacket => Boolean(packet?.lat !== undefined && packet.lon !== undefined));
    if (all.length === 0) return;
    const latest = all.reduce((a, b) => (a.ts > b.ts ? a : b));
    map.setView([latest.lat!, latest.lon!], Math.max(map.getZoom(), 15  ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(Object.keys(trackers).map((k) => trackers[k].latest?.ts))]);
  return null;
}

function App() {
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [baud, setBaud] = useState(9600);
  const [connected, setConnected] = useState(false);

  const [trackers, setTrackers] = useState<Record<string, Tracker>>({});
  const [packets, setPackets] = useState<TelemetryPacket[]>([]);
  const [trackerColors, setTrackerColors] = useState<Record<string, string>>({});
  const [hiddenTrackers, setHiddenTrackers] = useState<Set<string>>(new Set());
  const [hideAllTrackers, setHideAllTrackers] = useState(false);
  const [trackerOrder, setTrackerOrder] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [setDragOverId] = useState<string | null>(null);

  const processPacket = useCallback((packet: TelemetryPacket) => {
    setTrackerColors((prev) => {
      if (prev[packet.nodeId]) return prev;
      const nextIdx = Object.keys(prev).length;
      return { ...prev, [packet.nodeId]: colorForIndex(nextIdx) };
    });
    setPackets((prev) => [packet, ...prev].slice(0, 500));
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
    setTrackerOrder((prev) => (prev.includes(packet.nodeId) ? prev : [...prev, packet.nodeId]));
  }, []);

  const { startDemo, stopDemo } = useDemoSimulation(processPacket);

  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }, []);
  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>, targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setTrackerOrder((prev) => {
      const dragIndex = prev.indexOf(draggingId);
      const targetIndex = prev.indexOf(targetId);
      if (dragIndex === -1 || targetIndex === -1) return prev;
      const without = prev.filter((id) => id !== draggingId);
      const targetIdxInWithout = without.indexOf(targetId);
      const insertIdx = dragIndex < targetIndex ? targetIdxInWithout + 1 : targetIdxInWithout;
      const next = [...without];
      next.splice(insertIdx, 0, draggingId);
      return next.join("|") === prev.join("|") ? prev : next;
    });
    setDragOverId(targetId);
  }, [draggingId]);
  const handleDragLeave = useCallback(() => setDragOverId(null), []);
  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  function clearPackets() {
    setPackets([]);
  }

  function toggleTrackerHidden(nodeId: string) {
    setHiddenTrackers((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function toggleHideAll() {
    setHideAllTrackers((v) => !v);
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


  const trackersMemo = useMemo(() => trackers, [trackers]);
  const statusText = connected
    ? selectedPort === DEMO_PORT
      ? "Connected to URRG Demo"
      : `Connected to ${selectedPort} @ ${baud}`
    : "Disconnected";

  return (
    <main className="layout">
      <header className="toolbar">
        <div className="toolbar-left">
          <h2>Dispatch</h2>
          <div className="status">{statusText}</div>
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

      <section className="content">
        <div className="left-column">
          <div className="card map-card">
            <MapContainer center={[0, 0]} zoom={2} style={{ height: "100%", width: "100%" }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
              <ZoomToLatest trackers={trackersMemo} />
              {Object.values(trackers).map((t) => {
                const color = trackerColors[t.nodeId] ?? colorForIndex(0);
                const latlons = t.points.map((point) => [point.lat, point.lon] as [number, number]);
                const latest = t.latest;
                const isHidden = hiddenTrackers.has(t.nodeId) || hideAllTrackers;
                 return (
                   <div key={t.nodeId}>
                     {!isHidden && latlons.length > 1 && <Polyline positions={latlons} color={color} weight={3} />}
                     {!isHidden && latest && latest.lat !== undefined && latest.lon !== undefined && (
                       <CircleMarker center={[latest.lat, latest.lon]} pathOptions={{ color: color, fillColor: color }} radius={8}>
                         <Popup>
                           <div className="popup">
                             <strong>{t.nodeId}</strong>
                             <div>
                               {latest.lat.toFixed(6)}, {latest.lon.toFixed(6)}
                             </div>
                             <div>RSSI: {latest.rssi ?? "—"} SNR: {latest.snr ?? "—"}</div>
                             <div>Fix: {latest.fixStatus ?? "?"} Sats: {latest.sats ?? "—"}</div>
                           </div>
                         </Popup>
                       </CircleMarker>
                     )}
                   </div>
                 );
               })}
            </MapContainer>
          </div>

          <div className="card table-card">
            <div className="card-header">
              <span>Latest packets</span>
              <div className="header-actions">
                <button className="icon-button" title="Clear latest packets" onClick={clearPackets}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M10 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
             <div className="table-wrap">
               <table>
                 <thead>
                   <tr>
                     <th>Node</th>
                     <th>Latitude</th>
                     <th>Longitude</th>
                     <th>RSSI (dBm)</th>
                     <th>SNR (dB)</th>
                     <th>Fix</th>
                     <th>Satellites in View</th>
                     <th>Time</th>
                   </tr>
                 </thead>
                 <tbody>
                   {packets.map((packet) => (
                     <tr key={`${packet.ts}-${packet.nodeId}`}>
                       <td>{packet.nodeId}</td>
                       <td>{packet.lat === undefined ? "—" : packet.lat.toFixed(6)}</td>
                       <td>{packet.lon === undefined ? "—" : packet.lon.toFixed(6)}</td>
                       <td>{packet.rssi ?? "—"}</td>
                       <td>{packet.snr ?? "—"}</td>
                       <td>{packet.fixStatus ?? "?"}</td>
                       <td>{packet.sats ?? "—"}</td>
                       <td>{new Date(packet.ts).toLocaleTimeString()}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
           </div>
         </div>

        <aside className="right-column">
          <div className="card bubbles-card">
            <div className="card-header">
              <span>Trackers</span>
              <div className="header-actions">
                <button className="icon-button" title={hideAllTrackers ? 'Show trackers' : 'Hide trackers'} onClick={toggleHideAll}>
                  {hideAllTrackers ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.57 21.57 0 0 1 5.06-6.06" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M1 1l22 22" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
             <div className="bubble-list">
               {trackerOrder
                 .map((id) => trackers[id])
                 .filter(Boolean)
                 .map((t) => {
                   const latest = t!.latest;
                   const color = trackerColors[t!.nodeId] ?? colorForIndex(0);
                   const isHidden = hiddenTrackers.has(t.nodeId) || hideAllTrackers;
                    return (
                     <div key={t.nodeId}>
                       <div
                         className={`bubble ${isHidden ? 'muted' : ''} ${draggingId === t.nodeId ? 'dragging' : ''}`}
                         onDragOver={(e) => handleDragOver(e, t.nodeId)}
                         onDragLeave={handleDragLeave}
                         onDrop={handleDrop}
                       >
                         <div
                           className="bubble-handle"
                           draggable
                           title="Drag to reorder"
                           onDragStart={(e) => handleDragStart(e, t.nodeId)}
                           onDragEnd={handleDragEnd}
                         />
                         <div className="bubble-content">
                          <div className="bubble-header" style={{ borderLeft: `6px solid ${color}` }}>
                            <div className="bubble-title">{t.nodeId}</div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <div className="bubble-time">{latest ? new Date(latest.ts).toLocaleTimeString() : "—"}</div>
                              <button className="icon-small" title={isHidden ? 'Unhide tracker' : 'Hide tracker'} onClick={() => toggleTrackerHidden(t.nodeId)}>
                                {isHidden ? (
                                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                   <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                                   <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                                 </svg>
                               ) : (
                                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                   <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.57 21.57 0 0 1 5.06-6.06" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                                   <path d="M1 1l22 22" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                                 </svg>
                               )}
                              </button>
                            </div>
                          </div>

                       {latest ? (
                         <div className="bubble-body">
                           <div className="bubble-row">
                             <span>Latitude/Longitude</span>
                             <span>
                               {latest.lat === undefined ? "—" : latest.lat.toFixed(6)},
                                {latest.lon === undefined ? "—" : latest.lon.toFixed(6)}
                              </span>
                            </div>
                            <div className="bubble-row">
                              <span>RSSI / SNR</span>
                              <span>
                                {latest.rssi ?? "—"} dBm / {latest.snr ?? "—"} dB
                              </span>
                            </div>
                            <div className="bubble-row">
                              <span>Fix Status / Satellites in View</span>
                              <span>
                                {latest.fixStatus ?? "?"} / {latest.sats ?? "—"}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="bubble-body">No data</div>
                        )}
                         </div>
                       </div>
                      </div>
                    );
                  })}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

export default App;
