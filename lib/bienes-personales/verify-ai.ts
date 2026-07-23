import { accountingPdfModel, getGenerativeModel, requireGoogleAiApiKey } from "@/lib/ai/google-gemini";

/** Revisión breve de coherencia; el total y el impuesto estimado siguen siendo determinísticos en el servidor. */
export async function revisarBienesPersonalesConModelo(input: {
  year: number;
  entityDisplayName: string;
  totalActivos: number;
  totalPasivos: number;
  patrimonioNeto: number;
  minimoNoImponible: number;
  impuestoEstimado: number;
  activosPorTipo: Record<string, number>;
  cantidadBienes: number;
}): Promise<string> {
  requireGoogleAiApiKey();
  const model = getGenerativeModel(accountingPdfModel());
  const payload = JSON.stringify(input, null, 0);

  const prompt =
    "Sos un asistente contable para Argentina, revisando un borrador de patrimonio para Bienes Personales. " +
    "No inventés montos ni normativa; los totales ya fueron calculados por el sistema. " +
    "Revisá si la composición parece razonable o si falta algo típico (ej: si hay un inmueble pero no figura un rodado o cuentas bancarias, " +
    "o si la cantidad de bienes cargados parece muy baja para declarar). " +
    "Recordá que la valuación fiscal de inmuebles/rodados y el mínimo no imponible/escala deben verificarse contra los valores oficiales vigentes de ARCA del año declarado, " +
    "no contra los de este sistema. Máximo 4 frases en español rioplatense, tono profesional, sin exagerar certeza.\n\n" +
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
