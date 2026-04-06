import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ConfigTabProps {
  connected: boolean;
}

type AvailableConfigs = {
  // tracker
  freq: boolean;
  node_id: boolean;
  callsign: boolean;
  // marshal
  mode: boolean;
  main_alt: boolean;
  arm_alt: boolean;
  apogee_delay: boolean;
  bat_min: boolean;
};

const NONE_AVAILABLE: AvailableConfigs = {
  freq: false,
  node_id: false,
  callsign: false,
  mode: false,
  main_alt: false,
  arm_alt: false,
  apogee_delay: false,
  bat_min: false,
};

type LogKind = "sent" | "recv" | "error" | "info";
type LogEntry = { id: number; time: string; text: string; kind: LogKind };
let _logId = 0;

function stripAnsi(str: string): string {
  // Strip ANSI/VT100 escape sequences (color codes, cursor movement, etc.)
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

function hasSupportedKey(lines: string[], key: string): boolean {
  return lines.some((line) => line.trim() === `supported ${key}`);
}

export function ConfigTab({ connected }: ConfigTabProps) {
  const [probing, setProbing] = useState(false);
  const [probed, setProbed] = useState(false);
  const [available, setAvailable] = useState<AvailableConfigs>(NONE_AVAILABLE);
  const [deviceType, setDeviceType] = useState<"tracker" | "marshal">("tracker");
  const [sending, setSending] = useState(false);

  const [freqValue, setFreqValue] = useState("");
  const [nodeIdValue, setNodeIdValue] = useState("");
  const [callsignValue, setCallsignValue] = useState("");
  const [modeValue, setModeValue] = useState("");
  const [mainAltValue, setMainAltValue] = useState("");
  const [armAltValue, setArmAltValue] = useState("");
  const [apogeeDelayValue, setApogeeDelayValue] = useState("");
  const [batMinValue, setBatMinValue] = useState("");

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
        const lines = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const found: AvailableConfigs = {
          freq: hasSupportedKey(lines, "freq"),
          node_id: hasSupportedKey(lines, "node_id"),
          callsign: hasSupportedKey(lines, "callsign"),
          mode: hasSupportedKey(lines, "mode"),
          main_alt: hasSupportedKey(lines, "main_alt"),
          arm_alt: hasSupportedKey(lines, "arm_alt"),
          apogee_delay: hasSupportedKey(lines, "apogee_delay"),
          bat_min: hasSupportedKey(lines, "bat_min"),
        };
        const identity = lines.find((line) => line.startsWith("identity "));
        const isMarshal =
          identity === "identity marshal" ||
          found.mode ||
          found.main_alt ||
          found.arm_alt ||
          found.apogee_delay ||
          found.bat_min;
        setAvailable(found);
        setDeviceType(isMarshal ? "marshal" : "tracker");
        setProbing(false);
        setProbed(true);

        if (identity) {
          addLog("recv", identity);
        }
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
      setDeviceType("tracker");
      setFreqValue("");
      setNodeIdValue("");
      setCallsignValue("");
      setModeValue("");
      setMainAltValue("");
      setArmAltValue("");
      setApogeeDelayValue("");
      setBatMinValue("");
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
      { key: "mode", value: modeValue, enabled: available.mode },
      { key: "main_alt", value: mainAltValue, enabled: available.main_alt },
      { key: "arm_alt", value: armAltValue, enabled: available.arm_alt },
      { key: "apogee_delay", value: apogeeDelayValue, enabled: available.apogee_delay },
      { key: "bat_min", value: batMinValue, enabled: available.bat_min },
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
      (available.callsign && callsignValue !== "") ||
      (available.mode && modeValue !== "") ||
      (available.main_alt && mainAltValue !== "") ||
      (available.arm_alt && armAltValue !== "") ||
      (available.apogee_delay && apogeeDelayValue !== "") ||
      (available.bat_min && batMinValue !== ""));

  const trackerActive = connected && deviceType === "tracker";
  const marshalActive = connected && deviceType === "marshal";

  return (
    <section className="content config-layout">
      <div className="config-cards-row">
        <div className={`card config-card ${!trackerActive ? "config-card-inactive" : ""}`}>
          <div className="card-header">
            <span>Tracker Configuration</span>
            {trackerActive && (
              <button className="icon-button" onClick={probe} disabled={probing} title="Re-probe available configs">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 4 }}>
                  <path d="M21 12a9 9 0 10-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {probing ? "Probing…" : "Probe"}
              </button>
            )}
          </div>

          {!trackerActive && <p className="config-info">{connected ? "Connect to a tracker to configure these settings." : "Connect to a device to configure settings."}</p>}

          <div className="config-fields">
            <ConfigField label="Frequency (MHz)" hint="902 – 928 MHz" enabled={available.freq} probed={probed}>
              <input
                type="number"
                step="0.000001"
                min={902}
                max={928}
                value={freqValue}
                onChange={(e) => setFreqValue(e.target.value)}
                disabled={!trackerActive || !available.freq}
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
                disabled={!trackerActive || !available.node_id}
                placeholder={available.node_id ? "0 – 9" : "—"}
              />
            </ConfigField>

            <ConfigField label="Callsign" hint="Licensed operators only" enabled={available.callsign} probed={probed}>
              <input
                type="text"
                maxLength={12}
                value={callsignValue}
                onChange={(e) => setCallsignValue(e.target.value.toUpperCase())}
                disabled={!trackerActive || !available.callsign}
                placeholder={available.callsign ? "e.g. KD2YIE" : "—"}
              />
            </ConfigField>
          </div>

          <div className="config-actions">
            <button className="primary" disabled={!trackerActive || !canSend} onClick={sendAll}>
              {sending ? "Sending…" : "Send"}
            </button>
            <span className="config-actions-note">Settings are saved to device flash and apply after reboot.</span>
          </div>
        </div>

        <div className={`card config-card ${!marshalActive ? "config-card-inactive" : ""}`}>
          <div className="card-header">
            <span>Flight Computer Config</span>
            {marshalActive && (
              <button className="icon-button" onClick={probe} disabled={probing} title="Re-probe available configs">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 4 }}>
                  <path d="M21 12a9 9 0 10-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {probing ? "Probing…" : "Probe"}
              </button>
            )}
          </div>

          {!marshalActive && <p className="config-info">{connected ? "Connect to Marshal to configure these settings." : "Connect to a device to configure settings."}</p>}

          <div className="config-fields">
            <ConfigField label="Deploy Mode" hint="dual_deploy | drogue_only | main_only" enabled={available.mode} probed={probed}>
              <select value={modeValue} onChange={(e) => setModeValue(e.target.value)} disabled={!marshalActive || !available.mode}>
                <option value="">-- select --</option>
                <option value="dual_deploy">Dual Deploy</option>
                <option value="drogue_only">Drogue Only</option>
                <option value="main_only">Main Only</option>
              </select>
            </ConfigField>

            <ConfigField label="Main Deploy Altitude (ft)" hint="0 – 30000 ft AGL" enabled={available.main_alt} probed={probed}>
              <input
                type="number"
                min={0}
                max={30000}
                step={1}
                value={mainAltValue}
                onChange={(e) => setMainAltValue(e.target.value)}
                disabled={!marshalActive || !available.main_alt}
                placeholder={available.main_alt ? "e.g. 500" : "—"}
              />
            </ConfigField>

            <ConfigField label="Arming Altitude (ft)" hint="0 – 3000 ft AGL" enabled={available.arm_alt} probed={probed}>
              <input
                type="number"
                min={0}
                max={3000}
                step={1}
                value={armAltValue}
                onChange={(e) => setArmAltValue(e.target.value)}
                disabled={!marshalActive || !available.arm_alt}
                placeholder={available.arm_alt ? "e.g. 100" : "—"}
              />
            </ConfigField>

            <ConfigField label="Apogee Delay (ms)" hint="0 – 30000 ms" enabled={available.apogee_delay} probed={probed}>
              <input
                type="number"
                min={0}
                max={30000}
                step={1}
                value={apogeeDelayValue}
                onChange={(e) => setApogeeDelayValue(e.target.value)}
                disabled={!marshalActive || !available.apogee_delay}
                placeholder={available.apogee_delay ? "e.g. 0" : "—"}
              />
            </ConfigField>

            <ConfigField label="Min Battery (mV)" hint="0 – 10000 mV" enabled={available.bat_min} probed={probed}>
              <input
                type="number"
                min={0}
                max={10000}
                step={1}
                value={batMinValue}
                onChange={(e) => setBatMinValue(e.target.value)}
                disabled={!marshalActive || !available.bat_min}
                placeholder={available.bat_min ? "e.g. 3300" : "—"}
              />
            </ConfigField>
          </div>

          <div className="config-actions">
            <button className="primary" disabled={!marshalActive || !canSend} onClick={sendAll}>
              {sending ? "Sending…" : "Send"}
            </button>
            <span className="config-actions-note">Settings are saved to device flash and apply after reboot.</span>
          </div>
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
