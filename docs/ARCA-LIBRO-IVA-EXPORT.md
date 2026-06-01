# Exportación Libro IVA Digital — Integración ARCA

Documentación técnica para NotificasHub / Notificas SRL.

## Resumen

ARCA (IVA Simple / Registración Electrónica) **no importa un ZIP único** con todos los libros. El flujo real es **por módulo**:

| Módulo ARCA | Menú | Archivos TXT |
|-------------|------|--------------|
| **Compras** | Libro IVA → Compras → Importar | `LIBRO_IVA_DIGITAL_COMPRAS_CBTE.txt` + `LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS.txt` |
| **Ventas** | Libro IVA → Ventas → Importar | `LIBRO_IVA_DIGITAL_VENTAS_CBTE.txt` + `LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS.txt` |

NotificasHub genera esos archivos con encoding **ANSI (latin1)** y longitudes fijas según el manual AFIP (*libro-iva-digital-diseno-registros.pdf*).

## Pantalla en la app

**Contabilidad → ARCA / IVA → Exportaciones ARCA**

Botones:

1. **Descargar** junto a cada archivo (Compras CBTE, Compras alícuotas, Ventas CBTE, Ventas alícuotas)
2. **Descargar los 4 TXT** → baja en secuencia los cuatro archivos listos para importar (sin ZIP)

Cada descarga usa el nombre oficial ARCA, por ejemplo `LIBRO_IVA_DIGITAL_COMPRAS_CBTE.txt`.

## Qué archivo va en cada campo de ARCA

### Compras

1. Entrar a **Libro IVA → Compras → Importar**
2. **Archivo Compras** → subir `LIBRO_IVA_DIGITAL_COMPRAS_CBTE.txt`
   - Una línea por comprobante (325 caracteres)
   - Cabecera del comprobante de compra
3. **Archivo IVA Compras** → subir `LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS.txt`
   - Una línea por alícuota de Factura A gravada (84 caracteres)
   - Facturas B/C sin IVA discriminado: sin línea en alícuotas

### Ventas

1. Entrar a **Libro IVA → Ventas → Importar**
2. **Archivo Ventas** → `LIBRO_IVA_DIGITAL_VENTAS_CBTE.txt` (266 caracteres/línea)
3. **Archivo IVA Ventas** → `LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS.txt` (62 caracteres/línea)

## Cómo se generan los registros

Código: `lib/arca-export/iva-lines.ts`

- Normaliza facturas Firestore + gastos con IVA computable (`lib/arca-export/period-export.ts`)
- `buildLibroIvaTxtFiles()` separa ventas/compras y arma las 4 cadenas TXT
- `txtToLatin1Buffer()` convierte a latin1 para importación Windows/ARCA

Fuentes de **compras**:

- Facturas `tipo: compra` en `accounting_notificas_srl_facturas`
- Pagos/gastos con Factura A, IVA computable, CUIT, PV, número (`accounting_notificas_srl_pagos`)

Fuentes de **ventas**:

- Facturas `tipo: venta` en el mismo período

## Validación previa (`validateArcaExport`)

API: `GET /api/accounting/arca-export/validate?year=&month=`

Verifica antes de exportar:

**Compras:** comprobantes, alícuotas, neto gravado, IVA crédito, sin CUIT, Factura A sin IVA, gastos excluidos.

**Ventas:** comprobantes, alícuotas, neto gravado, débito fiscal, sin tipo comprobante.

Advertencias típicas:

- Existen compras sin CUIT
- Existen Facturas A sin IVA discriminado
- Existen comprobantes excluidos (ver Auditoría IVA)
- Existen ventas sin tipo de comprobante

## APIs de exportación

```
GET /api/accounting/export-libro-iva?year=2026&month=5&archivo=compras_cbte
GET /api/accounting/export-libro-iva?year=2026&month=5&archivo=compras_ali
GET /api/accounting/export-libro-iva?year=2026&month=5&archivo=ventas_cbte
GET /api/accounting/export-libro-iva?year=2026&month=5&archivo=ventas_ali
```

Valores de `archivo`: `compras_cbte`, `compras_ali`, `ventas_cbte`, `ventas_ali`.

Parámetro `force=1` omite el bloqueo cuando un módulo está vacío (uso interno).

## Cómo validar importación exitosa en ARCA

1. Tras importar Compras, ARCA muestra cantidad de registros importados vs. errores.
2. Verificar que **neto gravado** e **IVA crédito** coinciden con el panel de validación de NotificasHub.
3. Repetir para Ventas (débito fiscal).
4. El saldo técnico IVA en ARCA debe ser coherente con los totales del panel de validación previa.

## Archivos auxiliares (no importar en ARCA)

Los resúmenes y diagnósticos internos están disponibles en **Auditoría IVA** y en la API de validación (`VALIDACION_PREVIA.json` vía `/api/accounting/arca-export/validate`).

## Flujo recomendado para el usuario

1. Contabilidad → **Auditoría IVA** → corregir gastos excluidos
2. **ARCA / IVA** → revisar validación previa
3. Descargar e importar **Compras CBTE** y **Compras alícuotas** en el módulo Compras de ARCA
4. Descargar e importar **Ventas CBTE** y **Ventas alícuotas** en el módulo Ventas de ARCA
5. Confirmar totales en ARCA con el contador
