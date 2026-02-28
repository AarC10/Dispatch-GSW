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

export function ConfigTab({ connected }: ConfigTabProps) {
  const [probing, setProbing] = useState(false);
  const [probed, setProbed] = useState(false);
  const [available, setAvailable] = useState<AvailableConfigs>(NONE_AVAILABLE);

  const [freqValue, setFreqValue] = useState("");
  const [nodeIdValue, setNodeIdValue] = useState("");
  const [callsignValue, setCallsignValue] = useState("");

  const [freqStatus, setFreqStatus] = useState("");
  const [nodeIdStatus, setNodeIdStatus] = useState("");
  const [callsignStatus, setCallsignStatus] = useState("");

  const abortRef = useRef(false);

  function probe() {
    if (!connected || probing) return;
    abortRef.current = false;
    setProbing(true);
    setProbed(false);
    setAvailable(NONE_AVAILABLE);

    const accumulated: string[] = [];
    let unlistenFn: (() => void) | null = null;

    listen<string>("serial-line", (event) => {
      accumulated.push(event.payload);
    }).then((fn) => {
      unlistenFn = fn;

      invoke("write_serial", { data: "config" }).catch(console.error);

      setTimeout(() => {
        if (unlistenFn) unlistenFn();
        if (abortRef.current) return;

        const text = accumulated.join("\n");
        setAvailable({
          freq: text.includes("freq"),
          node_id: text.includes("node_id"),
          callsign: text.includes("callsign"),
        });
        setProbing(false);
        setProbed(true);
      }, 2000);
    });
  }

  // Probe when we first connect
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

  async function sendConfig(key: string, value: string, setStatus: (s: string) => void) {
    setStatus("Sending…");
    // Listen for a response line for up to 2 seconds after sending
    const lines: string[] = [];
    const unlisten = await listen<string>("serial-line", (e) => lines.push(e.payload));
    try {
      await invoke("write_serial", { data: `config ${key} ${value}` });
      await new Promise((res) => setTimeout(res, 1500));
      // Find last non-empty, non-log line
      const response = [...lines].reverse().find((l) => l.trim() && !l.startsWith("["));
      setStatus(response ?? "Sent");
    } catch (e) {
      setStatus(`Error: ${e}`);
    } finally {
      unlisten();
    }
  }

  const notConnectedMsg = !connected
    ? "Connect to a device to configure settings."
    : probing
    ? "Probing available configurations…"
    : probed && !available.freq && !available.node_id && !available.callsign
    ? "No configurable fields were reported by the device."
    : null;

  return (
    <section className="content">
      <div className="config-content">
        <div className="card config-card">
          <div className="card-header">
            <span>Device Configuration</span>
            {connected && (
              <button className="icon-button" onClick={probe} disabled={probing} title="Re-probe available configs">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M21 12a9 9 0 10-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {probing ? "Probing…" : "Probe"}
              </button>
            )}
          </div>

          {notConnectedMsg && (
            <p className="config-info">{notConnectedMsg}</p>
          )}

          <div className="config-fields">
            <ConfigField
              label="Frequency (MHz)"
              hint="902 – 928 MHz"
              enabled={available.freq}
              probed={probed}
            >
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
              <button
                className="icon-button button-success"
                disabled={!available.freq || !freqValue}
                onClick={() => sendConfig("freq", freqValue, setFreqStatus)}
              >
                Send
              </button>
              {freqStatus && <span className="config-status">{freqStatus}</span>}
            </ConfigField>

            <ConfigField
              label="Node ID"
              hint="0 – 9"
              enabled={available.node_id}
              probed={probed}
            >
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
              <button
                className="icon-button button-success"
                disabled={!available.node_id || nodeIdValue === ""}
                onClick={() => sendConfig("node_id", nodeIdValue, setNodeIdStatus)}
              >
                Send
              </button>
              {nodeIdStatus && <span className="config-status">{nodeIdStatus}</span>}
            </ConfigField>

            <ConfigField
              label="Callsign"
              hint="Licensed operators only"
              enabled={available.callsign}
              probed={probed}
            >
              <input
                type="text"
                maxLength={12}
                value={callsignValue}
                onChange={(e) => setCallsignValue(e.target.value.toUpperCase())}
                disabled={!available.callsign}
                placeholder={available.callsign ? "e.g. KD2YIE" : "—"}
              />
              <button
                className="icon-button button-success"
                disabled={!available.callsign || !callsignValue}
                onClick={() => sendConfig("callsign", callsignValue, setCallsignStatus)}
              >
                Send
              </button>
              {callsignStatus && <span className="config-status">{callsignStatus}</span>}
            </ConfigField>
          </div>

          <p className="config-info config-info-note">
            Settings are saved to device flash and apply after reboot.
          </p>
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
