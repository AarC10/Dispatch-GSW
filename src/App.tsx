import {useEffect, useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import "./App.css";

function App() {
    const [ports, setPorts] = useState<string[]>([]);
    const [selectedPort, setSelectedPort] = useState("");
    const [baud, setBaud] = useState(115200);


    async function refreshPorts() {
        try {
            const list = await invoke<string[]>("list_serial_ports");
            setPorts(list);
        } catch (e) {
            console.error(e);
        }
    }

    async function connect() {
    }


    useEffect(() => {
        refreshPorts();
    }, []);

    return (
        <main className="container">
            <section className="panel">
                <h3>Serial</h3>
                <div>
                    <label>Port:</label>
                    <select
                        value={selectedPort}
                        onChange={(e) => setSelectedPort(e.target.value)}
                    >
                        <option value="">-- Select --</option>
                        {ports.map((p) => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>
                    <button onClick={refreshPorts}>Refresh</button>
                </div>

                <div>
                    <label>Baud:</label>
                    <input
                        type="number"
                        value={baud}
                        onChange={(e) => setBaud(parseInt(e.target.value, 10))}
                    />
                </div>

                <button onClick={connect}>Connect</button>
            </section>
        </main>
    );
}

export default App;
