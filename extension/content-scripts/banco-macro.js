// Content script: extracto/movimientos de Banca Internet Empresas — Banco Macro.
// NOTA: alias de encabezado son una estimación (terminología típica de home banking argentino,
// AR: columnas separadas de Débito/Crédito son más comunes que un único Importe con signo).
// Falta confirmar contra el HTML real — ver plan "fase 0".

(function () {
  const { parseArNumber, parseArDate, findBestTable, dataRowsAfterHeader, cellText } = window.NhCommon;

  const ALIASES_SPLIT = {
    fecha: ["fecha"],
    concepto: ["concepto", "descripcion", "detalle", "leyenda"],
    debito: ["debito", "débito", "egreso"],
    credito: ["credito", "crédito", "ingreso"],
    referencia: ["referencia", "comprobante", "nro comprobante", "numero de comprobante", "nro de operacion"],
  };

  const ALIASES_SINGLE = {
    fecha: ["fecha"],
    concepto: ["concepto", "descripcion", "detalle", "leyenda"],
    importe: ["importe", "monto"],
    referencia: ["referencia", "comprobante", "nro comprobante", "numero de comprobante", "nro de operacion"],
    saldo: ["saldo"],
  };

  function scanSplit() {
    const best = findBestTable(ALIASES_SPLIT);
    if (!best || best.columnIndex.fecha == null || (best.columnIndex.debito == null && best.columnIndex.credito == null)) {
      return null;
    }
    const rows = dataRowsAfterHeader(best.table, best.headerRowIndex);
    const col = best.columnIndex;
    const out = [];
    for (const row of rows) {
      const fecha = parseArDate(cellText(row, col.fecha));
      if (!fecha) continue;
      const debito = col.debito != null ? parseArNumber(cellText(row, col.debito)) : 0;
      const credito = col.credito != null ? parseArNumber(cellText(row, col.credito)) : 0;
      const importe = credito - debito;
      if (importe === 0) continue;
      out.push({
        fecha,
        importe,
        concepto: col.concepto != null ? cellText(row, col.concepto) : "",
        referenciaBanco: col.referencia != null ? cellText(row, col.referencia) : "",
      });
    }
    return out.length ? out : null;
  }

  function scanSingle() {
    const best = findBestTable(ALIASES_SINGLE);
    if (!best || best.columnIndex.fecha == null || best.columnIndex.importe == null) return null;
    const rows = dataRowsAfterHeader(best.table, best.headerRowIndex);
    const col = best.columnIndex;
    const out = [];
    for (const row of rows) {
      const fecha = parseArDate(cellText(row, col.fecha));
      if (!fecha) continue;
      const importe = parseArNumber(cellText(row, col.importe));
      if (importe === 0) continue;
      out.push({
        fecha,
        importe,
        concepto: col.concepto != null ? cellText(row, col.concepto) : "",
        referenciaBanco: col.referencia != null ? cellText(row, col.referencia) : "",
        saldo: col.saldo != null ? parseArNumber(cellText(row, col.saldo)) : undefined,
      });
    }
    return out.length ? out : null;
  }

  function scan() {
    const movements = scanSplit() || scanSingle();
    if (!movements) return null;
    return { movements, cuentaNumero: "" };
  }

  window.NhCommon.registerScanHandler("bank_movements", scan);
})();
