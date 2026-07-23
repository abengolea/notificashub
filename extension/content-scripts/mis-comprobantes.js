// Content script: "Mis Comprobantes Recibidos" (fes.afip.gob.ar/mcmp/...).
// NOTA: los alias de encabezado se tomaron del export CSV/XLS que ya usa el import manual
// (lib/arca-mis-comprobantes/parse.ts) porque probablemente coincidan con los títulos de
// columna en pantalla. Falta confirmar contra el HTML real — ver plan "fase 0".

(function () {
  const { normalizeHeader, parseArNumber, parseArDate, findBestTable, dataRowsAfterHeader, cellText } =
    window.NhCommon;

  const HEADER_ALIASES = {
    fecha: ["fecha", "fecha de emision"],
    tipoCodigo: ["tipo de comprobante", "tipo"],
    puntoVenta: ["punto de venta"],
    numero: ["numero desde", "nro desde", "numero"],
    cae: ["cod autorizacion", "codigo de autorizacion", "cae"],
    contraparteCuit: ["nro doc emisor", "numero de documento"],
    contraparteNombre: ["denominacion emisor", "denominacion"],
    netoGravado: ["imp neto gravado", "importe neto gravado", "neto gravado total"],
    iva: ["iva", "total iva"],
    total: ["imp total", "importe total"],
  };

  function extractTipoCodigo(raw) {
    const s = String(raw ?? "").trim();
    const m = /^(\d+)/.exec(s);
    if (m) return parseInt(m[1], 10);
    return Math.trunc(parseArNumber(s));
  }

  function scan() {
    const best = findBestTable(HEADER_ALIASES);
    if (!best) return null;

    const rows = dataRowsAfterHeader(best.table, best.headerRowIndex);
    const col = best.columnIndex;
    const out = [];

    for (const row of rows) {
      const fecha = parseArDate(cellText(row, col.fecha));
      const numero = col.numero != null ? cellText(row, col.numero) : "";
      if (!fecha || !numero) continue;

      out.push({
        kind: "recibido",
        fecha,
        tipoCodigo: col.tipoCodigo != null ? extractTipoCodigo(cellText(row, col.tipoCodigo)) : 0,
        puntoVenta: col.puntoVenta != null ? cellText(row, col.puntoVenta) : "",
        numero,
        cae: col.cae != null ? cellText(row, col.cae) : "",
        contraparteCuit: col.contraparteCuit != null ? cellText(row, col.contraparteCuit).replace(/\D/g, "") : "",
        contraparteNombre: col.contraparteNombre != null ? cellText(row, col.contraparteNombre) : "",
        netoGravado: col.netoGravado != null ? parseArNumber(cellText(row, col.netoGravado)) : 0,
        netoNoGravado: 0,
        opExentas: 0,
        otrosTributos: 0,
        iva: col.iva != null ? parseArNumber(cellText(row, col.iva)) : 0,
        total: col.total != null ? parseArNumber(cellText(row, col.total)) : 0,
        moneda: "PES",
        tipoCambio: 1,
      });
    }

    if (out.length === 0) return null;
    return { rows: out };
  }

  window.NhCommon.registerScanHandler("mis_comprobantes", scan);
})();
