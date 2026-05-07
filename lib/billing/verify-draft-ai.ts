import OpenAI from "openai";

function getClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("Falta OPENAI_API_KEY en el entorno del servidor.");
  }
  return new OpenAI({ apiKey: key });
}

function modelo(): string {
  return process.env.BILLING_VERIFY_AI_MODEL?.trim() || "gpt-4o-mini";
}

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
  const openai = getClient();
  const payload = JSON.stringify(input, null, 0);
  const response = await openai.responses.create({
    model: modelo(),
    instructions:
      "Sos un asistente contable para Argentina. No inventés cotizaciones ni normativa. El usuario ya tiene montos calculados por el sistema.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Revisá si los importes son internamente coherentes (neto + IVA ≈ total según corresponda al tipo de comprobante implícito en los montos) y si el redondeo en pesos es razonable. ` +
              `Mencioná que el tipo de cambio debe contrastarse con el Banco Nación del día de emisión. Máximo 3 frases en español rioplatense, tono profesional. Datos JSON: ${payload}`,
          },
        ],
      },
    ],
  });

  if (response.error) {
    throw new Error(response.error.message ?? "Error del modelo.");
  }
  const t = response.output_text?.trim();
  if (!t) throw new Error("El modelo no devolvió texto.");
  return t;
}
