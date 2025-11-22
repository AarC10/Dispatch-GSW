import {useEffect, useState, useMemo} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
import {invoke} from "@tauri-apps/api/core";

type Packet = {
  nodeId: string;
  lat: number;
  lng: number;
  rssi?: number;
  snr?: number;
  fix?: boolean;
  sats?: number;
  ts: number;
};

type Tracker = {
  nodeId: string;
  points: { lat: number; lng: number; ts: number }[];
  latest?: Packet;
};

function ZoomToLatest({ trackers }: { trackers: Record<string, Tracker> }) {
  const map = useMap();
  useEffect(() => {
    const all = Object.values(trackers).map((t) => t.latest).filter(Boolean) as Packet[];
    if (all.length === 0) return;
    const latest = all.reduce((a, b) => (a.ts > b.ts ? a : b));
    map.setView([latest.lat, latest.lng], map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(Object.keys(trackers).map((k) => trackers[k].latest?.ts))]);
  return null;
}

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

function App() {
    const [ports, setPorts] = useState<string[]>([]);
    const [selectedPort, setSelectedPort] = useState("");
    const [baud, setBaud] = useState(9600);
    const [connected, setConnected] = useState(false);

    const [trackers, setTrackers] = useState<Record<string, Tracker>>({});
    const [packets, setPackets] = useState<Packet[]>([]);


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
                const l = await listen<string>("serial-line", (event) => {
                    const line = event.payload;
                    // try parse JSON packet first
                    try {
                        const p = JSON.parse(line) as Packet;
                        if (typeof p.lat === "number" && typeof p.lng === "number" && p.nodeId) {
                            p.ts = p.ts || Date.now();
                            setPackets((prev) => [p, ...prev].slice(0, 500));
                            setTrackers((prev) => {
                                const t = { ...(prev[p.nodeId] || { nodeId: p.nodeId, points: [] }) } as Tracker;
                                t.latest = p;
                                t.points = [...t.points, { lat: p.lat, lng: p.lng, ts: p.ts }].slice(-200);
                                return { ...prev, [p.nodeId]: t };
                            });
                            return;
                        }
                    } catch (e) {
                        // not JSON or malformed
                    }

                    // fallback: push raw packet entry
                    const raw: Packet = {
                        nodeId: "raw",
                        lat: 0,
                        lng: 0,
                        ts: Date.now(),
                    };
                    setPackets((prev) => [raw, ...prev].slice(0, 500));
                });
                // `listen` returns an unlisten function directly
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
        <main className="container">
            <section className="panel left-panel">
                <h3>Serial</h3>
                <div className="row">
                    <label>Port:</label>
                    <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
                        <option value="">-- Select --</option>
                        {ports.map((p) => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>
                    <button onClick={refreshPorts}>Refresh</button>
                </div>

                <div className="row">
                    <label>Baud:</label>
                    <input type="number" value={baud} onChange={(e) => setBaud(parseInt(e.target.value || "0", 10))} />
                </div>

                <div className="row">
                    {!connected ? (
                        <button onClick={connect} disabled={!selectedPort}>
                            Connect
                        </button>
                    ) : (
                        <button onClick={disconnect}>Disconnect</button>
                    )}
                </div>
            </section>

            <section className="panel map-panel">
                <MapContainer center={[0, 0]} zoom={2} style={{ height: "100%", width: "100%" }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                    <ZoomToLatest trackers={trackersMemo} />
                    {Object.values(trackers).map((t) => {
                        const color = colorForId(t.nodeId);
                        const latlngs = t.points.map((pt) => [pt.lat, pt.lng] as [number, number]);
                        const latest = t.latest;
                        return (
                            <>
                                {latlngs.length > 1 && <Polyline key={t.nodeId + "-line"} positions={latlngs} color={color} weight={3} />}
                                {latest && (
                                    <CircleMarker key={t.nodeId + "-latest"} center={[latest.lat, latest.lng]} pathOptions={{ color: color, fillColor: color }} radius={8}>
                                        <Popup>
                                            <div>
                                                <strong>{t.nodeId}</strong>
                                                <div>
                                                    {latest.lat.toFixed(6)}, {latest.lng.toFixed(6)}
                                                </div>
                                                <div>RSSI: {latest.rssi ?? "—"} SNR: {latest.snr ?? "—"}</div>
                                                <div>Fix: {latest.fix ? "yes" : "no"} Sats: {latest.sats ?? "—"}</div>
                                            </div>
                                        </Popup>
                                    </CircleMarker>
                                )}
                            </>
                        );
                    })}
                </MapContainer>

                <div className="bottom-row">
                    <div className="packet-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Node</th>
                                    <th>Lat</th>
                                    <th>Lng</th>
                                    <th>RSSI</th>
                                    <th>SNR</th>
                                    <th>Fix</th>
                                    <th>Sats</th>
                                    <th>Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {packets.map((p) => (
                                    <tr key={p.ts + p.nodeId}>
                                        <td>{p.nodeId}</td>
                                        <td>{p.lat.toFixed(6)}</td>
                                        <td>{p.lng.toFixed(6)}</td>
                                        <td>{p.rssi ?? "—"}</td>
                                        <td>{p.snr ?? "—"}</td>
                                        <td>{p.fix ? "yes" : "no"}</td>
                                        <td>{p.sats ?? "—"}</td>
                                        <td>{new Date(p.ts).toLocaleTimeString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="tracker-bubbles">
                        {Object.values(trackers)
                            .sort((a, b) => (b.latest?.ts ?? 0) - (a.latest?.ts ?? 0))
                            .map((t) => {
                                const latest = t.latest!;
                                const color = colorForId(t.nodeId);
                                return (
                                    <div className="bubble" key={t.nodeId}>
                                        <div className="bubble-header" style={{ borderLeft: `6px solid ${color}` }}>
                                            <strong>{t.nodeId}</strong>
                                        </div>
                                        {latest ? (
                                            <div className="bubble-body">
                                                <div>
                                                    {latest.lat.toFixed(6)}, {latest.lng.toFixed(6)}
                                                </div>
                                                <div>RSSI: {latest.rssi ?? "—"} SNR: {latest.snr ?? "—"}</div>
                                                <div>Fix: {latest.fix ? "yes" : "no"} Sats: {latest.sats ?? "—"}</div>
                                            </div>
                                        ) : (
                                            <div className="bubble-body">No data</div>
                                        )}
                                    </div>
                                );
                            })}
                    </div>
                </div>
            </section>
        </main>
     );
 }

 export default App;
