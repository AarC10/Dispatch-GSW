import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

type FixStatus = "NOFIX" | "FIX" | "DIFF" | "EST" | "UNKNOWN";

type TelemetryPacket = {
  nodeId: string;
  lat?: number;
  lng?: number;
  rssi?: number;
  snr?: number;
  fixStatus?: FixStatus;
  sats?: number;
  ts: number;
  raw?: string;
};

type Tracker = {
  nodeId: string;
  points: { lat: number; lng: number; ts: number }[];
  latest?: TelemetryPacket;
};

function colorForId(id: string) {
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
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
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

function parseZephyrLine(_line: string): TelemetryPacket | null {
  return null;
}

function ZoomToLatest({ trackers }: { trackers: Record<string, Tracker> }) {
  const map = useMap();
  useEffect(() => {
    const all = Object.values(trackers)
      .map((t) => t.latest)
      .filter((p): p is TelemetryPacket => Boolean(p && p.lat !== undefined && p.lng !== undefined));
    if (all.length === 0) return;
    const latest = all.reduce((a, b) => (a.ts > b.ts ? a : b));
    map.setView([latest.lat!, latest.lng!], Math.max(map.getZoom(), 5));
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
    try {
      await invoke("open_port", { port_name: selectedPort, baud_rate: baud });
      setConnected(true);
    } catch (e) {
      console.error("open_port failed", e);
      setConnected(false);
    }
  }

  async function disconnect() {
    try {
      await invoke("close_port");
    } catch (e) {
      console.warn("close_port failed", e);
    }
    setConnected(false);
  }

  useEffect(() => {
    refreshPorts();
  }, []);

  useEffect(() => {
    let unlisten: (() => Promise<void>) | null = null;
    (async () => {
      try {
        const l = await listen<any>("serial-packet", (event) => {
          const pktRaw = event.payload as any;
          if (!pktRaw) return;
          const pkt: TelemetryPacket = {
            nodeId: String(pktRaw.node_id ?? "unknown"),
            lat: pktRaw.latitude ?? undefined,
            lng: pktRaw.longitude ?? undefined,
            rssi: pktRaw.receiver_rssi ?? undefined,
            snr: pktRaw.receiver_snr ?? undefined,
            fixStatus: fixFromString(pktRaw.fix_status),
            sats: pktRaw.satellites_count ?? undefined,
            ts: pktRaw.timestamp_ms ?? Date.now(),
            raw: (pktRaw.raw_lines && pktRaw.raw_lines.join("\n")) || undefined,
          };

          setPackets((prev) => [pkt, ...prev].slice(0, 500));
          setTrackers((prev) => {
            const next = { ...prev } as Record<string, Tracker>;
            const t = next[pkt.nodeId] ?? { nodeId: pkt.nodeId, points: [] };
            if (pkt.lat !== undefined && pkt.lng !== undefined) {
              t.points = [...t.points, { lat: pkt.lat, lng: pkt.lng, ts: pkt.ts }].slice(-200);
            }
            t.latest = pkt;
            next[pkt.nodeId] = t;
            return next;
          });
        });
        unlisten = l;
      } catch (e) {
        console.warn("Could not attach serial listener", e);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const trackersMemo = useMemo(() => trackers, [JSON.stringify(trackers)]);

  return (
    <main className="layout">
      <header className="toolbar">
        <div className="toolbar-left">
          <h2>Dispatch</h2>
          <div className="status">{connected ? `Connected to ${selectedPort} @ ${baud}` : "Disconnected"}</div>
        </div>
        <div className="toolbar-right">
          <div className="field-group">
            <label>Port</label>
            <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
              <option value="">Select</option>
              {ports.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button onClick={refreshPorts}>Refresh</button>
          </div>
          <div className="field-group">
            <label>Baud</label>
            <input
              type="number"
              value={baud}
              onChange={(e) => setBaud(parseInt(e.target.value || "0", 10))}
              min={1200}
              step={1200}
            />
          </div>

          {!connected ? (
            <button onClick={connect} disabled={!selectedPort} className="primary">
              Connect
            </button>
          ) : (
            <button onClick={disconnect} className="ghost">
              Disconnect
            </button>
          )}
        </div>
      </header>

      <section className="content">
        <div className="left-column">
          <div className="card map-card">
            <MapContainer center={[0, 0]} zoom={2} style={{ height: "100%", width: "100%" }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
              <ZoomToLatest trackers={trackersMemo} />
              {Object.values(trackers).map((t) => {
                const color = colorForId(t.nodeId);
                const latlngs = t.points.map((pt) => [pt.lat, pt.lng] as [number, number]);
                const latest = t.latest;
                return (
                  <div key={t.nodeId}>
                    {latlngs.length > 1 && <Polyline positions={latlngs} color={color} weight={3} />}
                    {latest && latest.lat !== undefined && latest.lng !== undefined && (
                      <CircleMarker center={[latest.lat, latest.lng]} pathOptions={{ color: color, fillColor: color }} radius={8}>
                        <Popup>
                          <div className="popup">
                            <strong>{t.nodeId}</strong>
                            <div>
                              {latest.lat.toFixed(6)}, {latest.lng.toFixed(6)}
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
            <div className="card-header">Latest packets</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Lat</th>
                    <th>Lon</th>
                    <th>RSSI</th>
                    <th>SNR</th>
                    <th>Fix</th>
                    <th>Sats</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {packets.map((p) => (
                    <tr key={`${p.ts}-${p.nodeId}`}>
                      <td>{p.nodeId}</td>
                      <td>{p.lat !== undefined ? p.lat.toFixed(6) : "—"}</td>
                      <td>{p.lng !== undefined ? p.lng.toFixed(6) : "—"}</td>
                      <td>{p.rssi ?? "—"}</td>
                      <td>{p.snr ?? "—"}</td>
                      <td>{p.fixStatus ?? "?"}</td>
                      <td>{p.sats ?? "—"}</td>
                      <td>{new Date(p.ts).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside className="right-column">
          <div className="card bubbles-card">
            <div className="card-header">Trackers</div>
            <div className="bubble-list">
              {Object.values(trackers)
                .sort((a, b) => (b.latest?.ts ?? 0) - (a.latest?.ts ?? 0))
                .map((t) => {
                  const latest = t.latest;
                  const color = colorForId(t.nodeId);
                  return (
                    <div className="bubble" key={t.nodeId}>
                      <div className="bubble-header" style={{ borderLeft: `6px solid ${color}` }}>
                        <div className="bubble-title">{t.nodeId}</div>
                        <div className="bubble-time">{latest ? new Date(latest.ts).toLocaleTimeString() : "—"}</div>
                      </div>
                      {latest ? (
                        <div className="bubble-body">
                          <div className="bubble-row">
                            <span>Lat/Lng</span>
                            <span>
                              {latest.lat !== undefined ? latest.lat.toFixed(6) : "—"},{" "}
                              {latest.lng !== undefined ? latest.lng.toFixed(6) : "—"}
                            </span>
                          </div>
                          <div className="bubble-row">
                            <span>RSSI / SNR</span>
                            <span>
                              {latest.rssi ?? "—"} / {latest.snr ?? "—"}
                            </span>
                          </div>
                          <div className="bubble-row">
                            <span>Fix / Sats</span>
                            <span>
                              {latest.fixStatus ?? "?"} / {latest.sats ?? "—"}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="bubble-body">No data</div>
                      )}
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
