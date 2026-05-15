/**
 * Cliente mínimo para GET /v1/payments/search (pagos recibidos en la cuenta asociada al token).
 * @see https://www.mercadopago.com.ar/developers/es/reference/payments/_payments_search/get
 */

const MP_API = "https://api.mercadopago.com";

export type MpPaymentRow = {
  id: number | string;
  date_created?: string;
  transaction_amount?: number;
  description?: string | null;
  status?: string;
  payer?: { email?: string | null; first_name?: string | null };
  payment_type_id?: string | null;
};

type MpSearchResponse = {
  results?: MpPaymentRow[];
  paging?: { total?: number; offset?: number; limit?: number };
};

function mapMedioCobro(paymentTypeId: string | null | undefined): "tarjeta" | "otro" {
  if (!paymentTypeId) return "otro";
  const t = paymentTypeId.toLowerCase();
  if (t === "credit_card" || t === "debit_card" || t === "prepaid_card") return "tarjeta";
  if (t === "account_money" || t === "ticket" || t === "bank_transfer" || t === "atm") return "otro";
  return "otro";
}

export function mercadoPagoDateToYmdArgentina(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Fecha Mercado Pago inválida: ${iso}`);
  }
  return d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

export function conceptoFromMpPayment(p: MpPaymentRow): string {
  const desc = (p.description ?? "").trim();
  if (desc.length > 0) return desc.slice(0, 512);
  const mail = (p.payer?.email ?? "").trim();
  if (mail) return `Cobro MP #${p.id} · ${mail}`.slice(0, 512);
  return `Cobro Mercado Pago #${p.id}`.slice(0, 512);
}

export function medioFromMpPayment(p: MpPaymentRow): "tarjeta" | "otro" {
  return mapMedioCobro(p.payment_type_id ?? undefined);
}

export async function fetchApprovedPaymentsRange(params: {
  accessToken: string;
  beginDateIso: string;
  endDateIso: string;
  pageLimit?: number;
}): Promise<MpPaymentRow[]> {
  const pageLimit = params.pageLimit ?? 100;
  const out: MpPaymentRow[] = [];
  let offset = 0;

  for (;;) {
    const url = new URL(`${MP_API}/v1/payments/search`);
    url.searchParams.set("sort", "date_created");
    url.searchParams.set("criteria", "desc");
    url.searchParams.set("range", "date_created");
    url.searchParams.set("begin_date", params.beginDateIso);
    url.searchParams.set("end_date", params.endDateIso);
    url.searchParams.set("status", "approved");
    url.searchParams.set("limit", String(pageLimit));
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: "application/json",
      },
    });

    const text = await res.text();
    let json: MpSearchResponse;
    try {
      json = JSON.parse(text) as MpSearchResponse;
    } catch {
      throw new Error(`Mercado Pago: respuesta no JSON (${res.status})`);
    }

    if (!res.ok) {
      const msg =
        (json as { message?: string }).message ||
        (json as { error?: string }).error ||
        text.slice(0, 200);
      throw new Error(`Mercado Pago ${res.status}: ${msg}`);
    }

    const batch = json.results ?? [];
    for (const row of batch) {
      if (row?.status === "approved") out.push(row);
    }

    if (batch.length < pageLimit) break;
    offset += pageLimit;
    const total = json.paging?.total;
    if (typeof total === "number" && offset >= total) break;
  }

  return out;
}

export function ymdToMercadoPagoRangeUtc(beginYmd: string, endYmd: string): { beginDateIso: string; endDateIso: string } {
  const begin = /^\d{4}-\d{2}-\d{2}$/.exec(beginYmd.trim());
  const end = /^\d{4}-\d{2}-\d{2}$/.exec(endYmd.trim());
  if (!begin || !end) throw new Error("Rango inválido: usá YYYY-MM-DD para inicio y fin");
  return {
    beginDateIso: `${begin[0]}T00:00:00.000-03:00`,
    endDateIso: `${end[0]}T23:59:59.999-03:00`,
  };
}
