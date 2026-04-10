import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ConfigTabProps {
  connected: boolean;
}

type AvailableConfigs = {
  [key: string]: boolean;
};

const NONE_AVAILABLE: AvailableConfigs = {};

type FieldSpec = {
  label: string;
  hint: string;
  inputType: "number" | "text";
  step?: number;
  min?: number;
  max?: number;
  maxLength?: number;
  placeholder?: string;
  transform?: (value: string) => string;
};

const KNOWN_FIELDS: Record<string, FieldSpec> = {
  freq: {
    label: "Frequency (MHz)",
    hint: "410 - 450 or 902 - 928 MHz",
    inputType: "number",
    step: 0.000001,
    min: 410,
    max: 928,
    placeholder: "e.g. 433.920000 or 903.123456",
  },
  node_id: {
    label: "Node ID",
    hint: "0 - 9",
    inputType: "number",
    step: 1,
    min: 0,
    max: 9,
    placeholder: "0 - 9",
  },
  callsign: {
    label: "Callsign",
    hint: "Licensed operators only",
    inputType: "text",
    maxLength: 12,
    placeholder: "e.g. KD2YIE",
    transform: (value) => value.toUpperCase(),
  },
};

const IGNORED_CONFIG_KEYS = new Set(["config", "subcommands", "uart"]);

type LogKind = "sent" | "recv" | "error" | "info";
type LogEntry = { id: number; time: string; text: string; kind: LogKind };
let _logId = 0;

function stripAnsi(str: string): string {
  // Strip ANSI/VT100 escape sequences (color codes, cursor movement, etc.)
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

function humanizeKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getFieldSpec(key: string): FieldSpec {
  return (
    KNOWN_FIELDS[key] ?? {
      label: humanizeKey(key),
      hint: `Device-specific setting: ${key}`,
      inputType: "text",
      placeholder: `Value for ${key}`,
    }
  );
}

function extractConfigKeys(text: string): string[] {
  const keys = new Set<string>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim().toLowerCase();
    if (!line) continue;

    const patterns = [
      /^([a-z][a-z0-9_]*)$/,
      /^([a-z][a-z0-9_]*)\s*[:=-]/,
      /^config\s+([a-z][a-z0-9_]*)\b/,
      /^[*-]\s*([a-z][a-z0-9_]*)\b/,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        const key = match[1];
        if (!IGNORED_CONFIG_KEYS.has(key)) {
          keys.add(key);
        }
      }
    }
  }

  for (const key of Object.keys(KNOWN_FIELDS)) {
    if (!IGNORED_CONFIG_KEYS.has(key) && text.toLowerCase().includes(key)) {
      keys.add(key);
    }
  }

  return Array.from(keys).sort((a, b) => {
    const aKnown = Number(!(a in KNOWN_FIELDS));
    const bKnown = Number(!(b in KNOWN_FIELDS));
    if (aKnown !== bKnown) return aKnown - bKnown;
    return a.localeCompare(b);
  });
}

export function ConfigTab({ connected }: ConfigTabProps) {
  const [probing, setProbing] = useState(false);
  const [probed, setProbed] = useState(false);
  const [available, setAvailable] = useState<AvailableConfigs>(NONE_AVAILABLE);
  const [availableKeys, setAvailableKeys] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});

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
    setAvailableKeys([]);
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
        const keys = extractConfigKeys(text);
        const found = Object.fromEntries(keys.map((key) => [key, true]));
        setAvailable(found);
        setAvailableKeys(keys);
        setProbing(false);
        setProbed(true);
        setConfigValues((prev) => {
          const next: Record<string, string> = {};
          for (const key of keys) {
            next[key] = prev[key] ?? "";
          }
          return next;
        });

        if (keys.length > 0) {
          addLog("recv", `Available: ${keys.join(", ")}`);
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
      setAvailableKeys([]);
      return;
    }
    probe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  async function sendAll() {
    const fields = availableKeys
      .map((key) => ({ key, value: configValues[key] ?? "", enabled: available[key] }))
      .filter((f) => f.enabled && f.value !== "");

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
    availableKeys.some((key) => available[key] && (configValues[key] ?? "") !== "");

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
          {probed && availableKeys.length === 0 && <p className="config-info">No configurable fields were detected for this device.</p>}

          {availableKeys.map((key) => {
            const spec = getFieldSpec(key);
            const enabled = !!available[key];
            return (
              <ConfigField key={key} label={spec.label} hint={spec.hint} enabled={enabled} probed={probed}>
                <input
                  type={spec.inputType}
                  step={spec.step}
                  min={spec.min}
                  max={spec.max}
                  maxLength={spec.maxLength}
                  value={configValues[key] ?? ""}
                  onChange={(e) =>
                    setConfigValues((prev) => ({
                      ...prev,
                      [key]: spec.transform ? spec.transform(e.target.value) : e.target.value,
                    }))
                  }
                  disabled={!enabled}
                  placeholder={enabled ? spec.placeholder ?? "" : "—"}
                />
              </ConfigField>
            );
          })}
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
