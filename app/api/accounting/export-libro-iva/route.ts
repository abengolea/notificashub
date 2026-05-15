import { NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import JSZip from "jszip";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { ACCOUNTING_COMPANY_NAME, ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { buildLibroIvaTxtFiles, facturasFirestoreToNormalized, type FactFirestoreLike } from "@/lib/arca-export/iva-lines";

function bounds(year: number, month: number): { start: Timestamp; end: Timestamp } {
  const startD = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endD = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start: Timestamp.fromDate(startD), end: Timestamp.fromDate(endD) };
}

const LEEME = `============================================================
 EXPORT LIBRO DE IVA DIGITAL (formato registros ANSI / .txt)
 Empresa modelo: ${ACCOUNTING_COMPANY_NAME}
============================================================

Archivos dentro del ZIP:

  LIBRO_IVA_DIGITAL_VENTAS_CBTE.txt    — Diseño Ventas Cabecera (266 caracteres por línea)
  LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS.txt — Diseño Ventas Alicuotas (62 caracteres)
  LIBRO_IVA_DIGITAL_COMPRAS_CBTE.txt — Diseño Compras Cabecera (325 caracteres)
  LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS.txt — Diseño Compras Alicuotas (84 caracteres)
  RESUMEN_PERIODO_GANANCIAS_ORIENT.csv — Sumas internas NotificasHub (no oficial)
  resumen_ivahub.json — JSON mismo resumen

Antes de importar en IVA Simple / Registración Electrónica (ARCA):

1) Verificación con tu contador y libro-iva-digital-diseno-registros.pdf (AFIP).
2) ANSI / latin1 al subir desde Windows cuando la aplicación lo requiera.
3) Mantener orden correlativo cabeceras y alicuotas como indica el manual.
4) Comprobantes clase B/C: cantidad de alicuotas = 0 (sin línea en archivo alicuotas).
5) Factura clase A gravada con IVA positivo incluye línea adicional en alicuotas.

Ganancias: ARCA usa otros aplicativos; el CSV/JSON es soporte orientativo sólo desde NotificasHub.

Enlaces:
https://www.afip.gob.ar/iva/iva-simple/especificaciones-especiales.asp
https://www.afip.gob.ar/iva/documentos/libro-iva-digital-diseno-registros.pdf
`;

export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const y = parseInt(searchParams.get("year") ?? "", 10);
  const m = parseInt(searchParams.get("month") ?? "", 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return new Response(JSON.stringify({ error: "Query year y month requeridos" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { start, end } = bounds(y, m);

  try {
    const factSnap = await db
      .collection(ACCOUNTING_COLLECTIONS.facturas)
      .where("fecha", ">=", start)
      .where("fecha", "<=", end)
      .limit(4000)
      .get();

    const normalized = facturasFirestoreToNormalized(
      factSnap.docs.map((d) => ({
        id: d.id,
        data: () => d.data() as FactFirestoreLike,
      }))
    );

    let ventasNeto = 0;
    let ventasIva = 0;
    let comprasNeto = 0;
    let comprasIva = 0;
    for (const f of normalized) {
      const net = f.netoGravado || 0;
      const iv = f.iva || 0;
      if (f.tipo === "venta") {
        ventasNeto += net;
        ventasIva += iv;
      } else {
        comprasNeto += net;
        comprasIva += iv;
      }
    }

    const resumenIvahub = {
      empresaNombre: ACCOUNTING_COMPANY_NAME,
      periodo: `${y}-${String(m).padStart(2, "0")}`,
      facturasIncluidas: normalized.length,
      ventas: { netoGravado: ventasNeto, iva: ventasIva },
      compras: { netoGravado: comprasNeto, iva: comprasIva },
      diferenciaIVAOrientativa: ventasIva - comprasIva,
    };

    const ganancCsv =
      `"Concepto";"Valor ARS"\n` +
      `"Periodo YYYY-MM";"${String(y)}-${String(m).padStart(2, "0")}"\n` +
      `"IVA Debito neto gravado ventas";"${ventasNeto.toFixed(2)}"\n` +
      `"IVA Debito impuesto ventas";"${ventasIva.toFixed(2)}"\n` +
      `"IVA Credito neto gravado compras";"${comprasNeto.toFixed(2)}"\n` +
      `"IVA Credito impuesto compras";"${comprasIva.toFixed(2)}"\n` +
      `"Saldo tecnico IVA orientativo debito-cred";"${resumenIvahub.diferenciaIVAOrientativa.toFixed(2)}"\n` +
      `\n`;

    const libr = buildLibroIvaTxtFiles(normalized);

    const zip = new JSZip();
    zip.file("README_ARCA_Libro_IVA_digital.txt", LEEME.replace(/\r?\n/g, "\r\n"));
    zip.file(
      "LIBRO_IVA_DIGITAL_VENTAS_CBTE.txt",
      Buffer.from(libr.ventasCbte.replace(/\r?\n/g, "\r\n"), "latin1")
    );
    zip.file(
      "LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS.txt",
      Buffer.from(libr.ventasAli.replace(/\r?\n/g, "\r\n"), "latin1")
    );
    zip.file(
      "LIBRO_IVA_DIGITAL_COMPRAS_CBTE.txt",
      Buffer.from(libr.comprasCbte.replace(/\r?\n/g, "\r\n"), "latin1")
    );
    zip.file(
      "LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS.txt",
      Buffer.from(libr.comprasAli.replace(/\r?\n/g, "\r\n"), "latin1")
    );
    zip.file("RESUMEN_PERIODO_GANANCIAS_ORIENT.csv", ganancCsv.replace(/\r?\n/g, "\r\n"));
    zip.file("resumen_ivahub.json", JSON.stringify(resumenIvahub, null, 2));

    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const safeName = `libroiva_ARCA_${y}-${String(m).padStart(2, "0")}.zip`;

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[export-libro-iva]", err);
    const status = msg.includes("[LibroIVA") ? 422 : 500;
    return new Response(
      JSON.stringify({
        error: status === 422 ? "Fallo al armar registros ARCA" : "Error interno",
        detalle: msg,
      }),
      {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }
}
