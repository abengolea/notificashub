// Helpers compartidos por los content scripts. Se cargan antes que el script específico de
// cada sitio (ver manifest.json). Todo queda en `window.NhCommon` para no ensuciar el scope global.

(function () {
  function normalizeHeader(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseArNumber(raw) {
    let s = String(raw ?? "").trim();
    if (!s) return 0;
    s = s.replace(/\s/g, "").replace(/\$/g, "");
    if (s.includes(",") && s.includes(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",")) {
      s = s.replace(",", ".");
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  /** dd/mm/yyyy | yyyy-mm-dd -> yyyy-mm-dd */
  function parseArDate(raw) {
    const s = String(raw ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
  }

  /**
   * Busca, entre todas las <table> de la página, la que tenga una fila de encabezado que
   * matchee la mayor cantidad de `headerAliases` (mapa: nombre de campo -> lista de textos
   * de encabezado posibles). Evita depender de un índice de columna fijo, que se rompe con
   * cualquier cambio menor de layout.
   */
  function findBestTable(headerAliases) {
    const tables = Array.from(document.querySelectorAll("table"));
    let best = null;

    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll("tr"));
      for (let rowIdx = 0; rowIdx < Math.min(rows.length, 3); rowIdx++) {
        const cells = Array.from(rows[rowIdx].querySelectorAll("th,td")).map((c) =>
          normalizeHeader(c.textContent)
        );
        if (cells.length < 2) continue;

        const columnIndex = {};
        let matches = 0;
        for (const [field, aliases] of Object.entries(headerAliases)) {
          const idx = cells.findIndex((c) => aliases.some((a) => c === a || c.includes(a)));
          if (idx >= 0) {
            columnIndex[field] = idx;
            matches += 1;
          }
        }

        if (matches >= Math.ceil(Object.keys(headerAliases).length * 0.6)) {
          if (!best || matches > best.matches) {
            best = { table, headerRowIndex: rowIdx, columnIndex, matches };
          }
        }
      }
    }

    return best;
  }

  function dataRowsAfterHeader(table, headerRowIndex) {
    const rows = Array.from(table.querySelectorAll("tr"));
    return rows.slice(headerRowIndex + 1).filter((r) => r.querySelectorAll("td").length > 0);
  }

  function cellText(row, colIndex) {
    const cells = row.querySelectorAll("td,th");
    const cell = cells[colIndex];
    return cell ? cell.textContent.trim() : "";
  }

  function registerScanHandler(kind, scanFn) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== "SCAN") return false;
      try {
        const data = scanFn();
        if (!data) {
          sendResponse({ ok: false, error: "No se encontró la tabla esperada en esta página." });
        } else {
          sendResponse({ ok: true, kind, data });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return false;
    });
  }

  window.NhCommon = {
    normalizeHeader,
    parseArNumber,
    parseArDate,
    findBestTable,
    dataRowsAfterHeader,
    cellText,
    registerScanHandler,
  };
})();
