// Service worker: única pieza de la extensión que hace fetch() al backend de NotificasHub.
// Los content scripts y el popup nunca llaman directo a la API — le mandan un mensaje a este
// background, que agrega el header x-extension-token y hace el pedido. Esto evita problemas de
// CORS (un fetch desde el service worker con host_permissions no queda sujeto al CORS de la
// página externa) y mantiene el token fuera del contexto de sitios de terceros.

const DEFAULT_CONFIG = {
  backendUrl: "http://localhost:3000",
  extensionToken: "",
  entityId: "notificas_srl",
};

async function getConfig() {
  const stored = await chrome.storage.local.get(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, ...stored };
}

async function callApi(path, { method = "GET", body, binary = false } = {}) {
  const cfg = await getConfig();
  if (!cfg.extensionToken) {
    throw new Error("Falta configurar el token de la extensión (abrí el popup).");
  }
  const url = `${cfg.backendUrl.replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "x-extension-token": cfg.extensionToken,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (binary) {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const blob = await res.blob();
    return { blob, filename: match ? match[1] : "descarga.xlsx" };
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

async function withEntity(path, cfg) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}entity=${encodeURIComponent(cfg.entityId)}`;
}

async function handleMessage(msg) {
  const cfg = await getConfig();

  switch (msg.type) {
    case "GET_CONFIG":
      return { ok: true, config: cfg };

    case "SET_CONFIG":
      await chrome.storage.local.set(msg.config);
      return { ok: true };

    case "IMPORT_MIS_COMPROBANTES": {
      const path = await withEntity("/api/extension/mis-comprobantes", cfg);
      const json = await callApi(path, { method: "POST", body: { rows: msg.rows, dryRun: !!msg.dryRun } });
      return { ok: true, result: json };
    }

    case "IMPORT_BANK_MOVEMENTS": {
      const path = await withEntity("/api/extension/bank-movements", cfg);
      const json = await callApi(path, {
        method: "POST",
        body: { movements: msg.movements, cuentaNumero: msg.cuentaNumero, dryRun: !!msg.dryRun },
      });
      return { ok: true, result: json };
    }

    case "DOWNLOAD_CM05": {
      const qs = new URLSearchParams({ year: String(msg.year), month: String(msg.month) });
      const path = await withEntity(`/api/extension/export-cm05?${qs.toString()}`, cfg);
      const { blob, filename } = await callApi(path, { binary: true });
      const dataUrl = await blobToDataUrl(blob);
      const downloadId = await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
      return { ok: true, downloadId, filename };
    }

    default:
      return { ok: false, error: `Mensaje desconocido: ${msg.type}` };
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true; // respuesta async
});
