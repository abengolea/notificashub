const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $("log");
  const time = new Date().toLocaleTimeString("es-AR");
  el.textContent = `[${time}] ${msg}\n${el.textContent}`.slice(0, 4000);
};

let lastScan = null; // { kind: "mis_comprobantes" | "bank_movements", data: {...} }

async function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

async function loadConfig() {
  const resp = await send({ type: "GET_CONFIG" });
  if (!resp.ok) return;
  $("backendUrl").value = resp.config.backendUrl;
  $("extensionToken").value = resp.config.extensionToken;
  $("entityId").value = resp.config.entityId;
  const now = new Date();
  $("cm05Year").value = now.getFullYear();
  $("cm05Month").value = now.getMonth() + 1;
}

$("saveConfig").addEventListener("click", async () => {
  await send({
    type: "SET_CONFIG",
    config: {
      backendUrl: $("backendUrl").value.trim() || "http://localhost:3000",
      extensionToken: $("extensionToken").value.trim(),
      entityId: $("entityId").value,
    },
  });
  log("Configuración guardada.");
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

$("scanPage").addEventListener("click", async () => {
  $("confirmImport").disabled = true;
  lastScan = null;
  const tab = await activeTab();
  if (!tab?.id) {
    log("No se encontró la pestaña activa.");
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "SCAN" }, (resp) => {
    if (chrome.runtime.lastError) {
      log(`Esta página no tiene un lector configurado (${chrome.runtime.lastError.message}).`);
      return;
    }
    if (!resp?.ok) {
      log(`No se pudo leer la página: ${resp?.error || "error desconocido"}`);
      return;
    }
    lastScan = resp;
    log(`Leídas ${resp.data.rows?.length ?? resp.data.movements?.length ?? 0} filas (${resp.kind}). Revisá y confirmá.`);
    $("confirmImport").disabled = false;
  });
});

$("confirmImport").addEventListener("click", async () => {
  if (!lastScan) return;
  $("confirmImport").disabled = true;
  try {
    let resp;
    if (lastScan.kind === "mis_comprobantes") {
      resp = await send({ type: "IMPORT_MIS_COMPROBANTES", rows: lastScan.data.rows, dryRun: false });
    } else if (lastScan.kind === "bank_movements") {
      resp = await send({
        type: "IMPORT_BANK_MOVEMENTS",
        movements: lastScan.data.movements,
        cuentaNumero: lastScan.data.cuentaNumero,
        dryRun: false,
      });
    } else {
      log(`Tipo de escaneo desconocido: ${lastScan.kind}`);
      return;
    }
    if (!resp.ok) {
      log(`Error al importar: ${resp.error}`);
      return;
    }
    log(`Importado: ${JSON.stringify(resp.result)}`);
    lastScan = null;
  } finally {
    $("confirmImport").disabled = true;
  }
});

$("downloadCm05").addEventListener("click", async () => {
  const year = parseInt($("cm05Year").value, 10);
  const month = parseInt($("cm05Month").value, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    log("Año/mes inválidos.");
    return;
  }
  log(`Descargando CM05 ${month}/${year}…`);
  const resp = await send({ type: "DOWNLOAD_CM05", year, month });
  if (!resp.ok) {
    log(`Error al descargar: ${resp.error}`);
    return;
  }
  log(`Descargado: ${resp.filename}. Subilo a mano en SIFERE WEB.`);
});

loadConfig();
