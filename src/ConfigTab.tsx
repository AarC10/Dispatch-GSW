import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ConfigTabProps {
  connected: boolean;
}

type AvailableConfigs = {
  freq: boolean;
  node_id: boolean;
  callsign: boolean;
};

const NONE_AVAILABLE: AvailableConfigs = { freq: false, node_id: false, callsign: false };

type LogKind = "sent" | "recv" | "error" | "info";
type LogEntry = { id: number; time: string; text: string; kind: LogKind };
let _logId = 0;

function stripAnsi(str: string): string {
  // Strip ANSI/VT100 escape sequences (color codes, cursor movement, etc.)
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

export function ConfigTab({ connected }: ConfigTabProps) {
  const [probing, setProbing] = useState(false);
  const [probed, setProbed] = useState(false);
  const [available, setAvailable] = useState<AvailableConfigs>(NONE_AVAILABLE);
  const [sending, setSending] = useState(false);

  const [freqValue, setFreqValue] = useState("");
  const [nodeIdValue, setNodeIdValue] = useState("");
  const [callsignValue, setCallsignValue] = useState("");

  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  function addLog(kind: LogKind, text: string) {
    const time = new Date().toLocaleTimeString();
    setLog((prev) => [...prev, { id: _logId++, time, text, kind }]);
  }

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  function probe() {
    if (!connected || probing) return;
    abortRef.current = false;
    setProbing(true);
    setProbed(false);
    setAvailable(NONE_AVAILABLE);
    addLog("info", "Probing device for available configurations…");

    const accumulated: string[] = [];
    let unlistenFn: (() => void) | null = null;

    listen<string>("serial-line", (event) => {
      accumulated.push(stripAnsi(event.payload));
    }).then((fn) => {
      unlistenFn = fn;
      invoke("write_serial", { data: "config" }).catch(console.error);

      setTimeout(() => {
        if (unlistenFn) unlistenFn();
        if (abortRef.current) return;

        const text = accumulated.join("\n");
        const found: AvailableConfigs = {
          freq: text.includes("freq"),
          node_id: text.includes("node_id"),
          callsign: text.includes("callsign"),
        };
        setAvailable(found);
        setProbing(false);
        setProbed(true);

        const names = (Object.keys(found) as (keyof AvailableConfigs)[]).filter((k) => found[k]);
        if (names.length > 0) {
          addLog("recv", `Available: ${names.join(", ")}`);
        } else {
          addLog("info", "No configurable fields reported by device.");
        }
      }, 2000);
    });
  }

  useEffect(() => {
    if (!connected) {
      abortRef.current = true;
      setProbing(false);
      setProbed(false);
      setAvailable(NONE_AVAILABLE);
      return;
    }
    probe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  async function sendAll() {
    const fields = [
      { key: "freq", value: freqValue, enabled: available.freq },
      { key: "node_id", value: nodeIdValue, enabled: available.node_id },
      { key: "callsign", value: callsignValue, enabled: available.callsign },
    ].filter((f) => f.enabled && f.value !== "");

    if (fields.length === 0) return;
    setSending(true);

    for (const field of fields) {
      const cmd = `config ${field.key} ${field.value}`;
      addLog("sent", cmd);

      const lines: string[] = [];
      const unlisten = await listen<string>("serial-line", (e) => {
        lines.push(stripAnsi(e.payload));
      });

      try {
        await invoke("write_serial", { data: cmd });
        await new Promise((res) => setTimeout(res, 1000));
        const response = [...lines]
          .reverse()
          .find((l) => l.trim() && !l.trim().startsWith("["));
        addLog("recv", response?.trim() ?? "OK");
      } catch (e) {
        addLog("error", String(e));
      } finally {
        unlisten();
      }
    }

    setSending(false);
  }

  const canSend =
    !sending &&
    ((available.freq && freqValue !== "") ||
      (available.node_id && nodeIdValue !== "") ||
      (available.callsign && callsignValue !== ""));

  return (
    <section className="content config-layout">
      <div className="card config-card">
        <div className="card-header">
          <span>Device Configuration</span>
          {connected && (
            <button className="icon-button" onClick={probe} disabled={probing} title="Re-probe available configs">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 4 }}>
                <path d="M21 12a9 9 0 10-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {probing ? "Probing…" : "Probe"}
            </button>
          )}
        </div>

        {!connected && <p className="config-info">Connect to a device to configure settings.</p>}

        <div className="config-fields">
          <ConfigField label="Frequency (MHz)" hint="902 – 928 MHz" enabled={available.freq} probed={probed}>
            <input
              type="number"
              step="0.000001"
              min={902}
              max={928}
              value={freqValue}
              onChange={(e) => setFreqValue(e.target.value)}
              disabled={!available.freq}
              placeholder={available.freq ? "e.g. 903.123456" : "—"}
            />
          </ConfigField>

          <ConfigField label="Node ID" hint="0 – 9" enabled={available.node_id} probed={probed}>
            <input
              type="number"
              min={0}
              max={9}
              step={1}
              value={nodeIdValue}
              onChange={(e) => setNodeIdValue(e.target.value)}
              disabled={!available.node_id}
              placeholder={available.node_id ? "0 – 9" : "—"}
            />
          </ConfigField>

          <ConfigField label="Callsign" hint="Licensed operators only" enabled={available.callsign} probed={probed}>
            <input
              type="text"
              maxLength={12}
              value={callsignValue}
              onChange={(e) => setCallsignValue(e.target.value.toUpperCase())}
              disabled={!available.callsign}
              placeholder={available.callsign ? "e.g. KD2YIE" : "—"}
            />
          </ConfigField>
        </div>

        <div className="config-actions">
          <button className="primary" disabled={!canSend} onClick={sendAll}>
            {sending ? "Sending…" : "Send"}
          </button>
          <span className="config-actions-note">Settings are saved to device flash and apply after reboot.</span>
        </div>
      </div>

      <div className="card config-log-card">
        <div className="card-header">
          <span>Log</span>
          {log.length > 0 && (
            <button className="icon-button" onClick={() => setLog([])} title="Clear log">
              Clear
            </button>
          )}
        </div>
        <div className="config-log" ref={logRef}>
          {log.length === 0 ? (
            <span className="config-log-empty">No activity yet.</span>
          ) : (
            log.map((entry) => (
              <div key={entry.id} className={`config-log-entry config-log-${entry.kind}`}>
                <span className="config-log-time">{entry.time}</span>
                <span className="config-log-text">{entry.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ConfigField({
  label,
  hint,
  enabled,
  probed,
  children,
}: {
  label: string;
  hint: string;
  enabled: boolean;
  probed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`config-field ${!enabled ? "config-field-disabled" : ""}`}>
      <div className="config-field-label">
        <span>{label}</span>
        <span className="config-field-hint">{hint}</span>
        {probed && !enabled && <span className="config-field-badge">Not available</span>}
      </div>
      <div className="config-field-row">{children}</div>
    </div>
  );
}
