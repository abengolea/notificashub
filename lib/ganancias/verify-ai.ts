import { accountingPdfModel, getGenerativeModel, requireGoogleAiApiKey } from "@/lib/ai/google-gemini";

/** Revisión breve de coherencia; el resultado neto sigue siendo determinístico en el servidor. */
export async function revisarGananciasConModelo(input: {
  year: number;
  entityDisplayName: string;
  isIndividual: boolean;
  totalIngresoBruto: number;
  totalGastosDeducibles: number;
  totalDeduccionesPersonales: number;
  totalResultadoNeto: number;
  mesesConIngresoCero: number[];
  mesesConGastoSinIngreso: number[];
}): Promise<string> {
  requireGoogleAiApiKey();
  const model = getGenerativeModel(accountingPdfModel());
  const payload = JSON.stringify(input, null, 0);

  const prompt =
    "Sos un asistente contable para Argentina, revisando un resumen anual de Ganancias (devengado) ya calculado por el sistema. " +
    "No inventés montos, escalas ni normativa. Revisá si la relación ingreso/gasto parece razonable mes a mes, " +
    "si hay meses con gasto pero sin ningún ingreso (posible carga incompleta o gasto mal fechado), " +
    "y si el resultado neto anual parece coherente con la actividad. " +
    "Recordá que esto es insumo para la DDJJ, no una liquidación certificada, y que las deducciones especiales de la escala de Ganancias " +
    "no están incluidas acá. Máximo 4 frases en español rioplatense, tono profesional, sin exagerar certeza.\n\n" +
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
