import {
  billingVerifyModel,
  getGenerativeModel,
  requireGoogleAiApiKey,
} from "@/lib/ai/google-gemini";

/** Revisión breve; el cálculo contable sigue siendo determinístico en el servidor. */
export async function verificarBorradorConModelo(input: {
  clientRazonSocial: string;
  cuit: string;
  fecha: string;
  usd: number;
  arsPorUsd: number;
  netoGravado: number;
  iva: number;
  total: number;
  fuenteTipoCambio: string;
}): Promise<string> {
  requireGoogleAiApiKey();
  const model = getGenerativeModel(billingVerifyModel());
  const payload = JSON.stringify(input, null, 0);

  const prompt =
    "Sos un asistente contable para Argentina. No inventés cotizaciones ni normativa. El usuario ya tiene montos calculados por el sistema.\n" +
    "Revisá si los importes son internamente coherentes (neto + IVA ≈ total según corresponda al tipo de comprobante implícito en los montos) y si el redondeo en pesos es razonable. " +
    "Mencioná que el tipo de cambio debe contrastarse con el Banco Nación del día de emisión. Máximo 3 frases en español rioplatense, tono profesional.\n\n" +
    "Datos JSON:\n" +
    payload;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2 },
  });

  const t = result.response.text()?.trim();
  if (!t) throw new Error("El modelo no devolvió texto.");
  return t;
}
