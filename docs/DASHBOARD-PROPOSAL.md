# Propuesta: Dashboard completo con mensajes pagos por app

## Situación actual

- **Dashboard**: Muestra mensajes de `whatsappMessages`, filtro por `appId`, stats globales (total hoy, delivered, read, failed).
- **Fuente de datos**: `whatsappMessages` — cada app crea documentos al enviar; el webhook de Meta actualiza `status`, `deliveredAt`, `readAt`.
- **Router**: `wa_messages` tiene `tenantId` y `pricingCategory` para mensajes entrantes, pero el dashboard no usa esta colección.

## Objetivo

Dashboard con **vista separada por app** para ver cuántos **mensajes pagos** gasta cada app (HeartLink, Náutica, etc.).

---

## Cambios propuestos

### 1. Capturar `pricingCategory` en statuses (webhook)

Meta envía en los webhooks de status un objeto `pricing` con `category` (utility, marketing, authentication, etc.). Hoy solo guardamos `status`; falta persistir `pricingCategory` en `whatsappMessages`.

**Archivo**: `src/whatsapp/webhook-handler.ts` + `app/api/whatsapp/webhook/route.ts`

- Extender `extractStatuses()` para incluir `pricingCategory` cuando exista.
- Al actualizar status en `whatsappMessages`, guardar también `pricingCategory`.

### 2. Nueva API: estadísticas por app

**Endpoint**: `GET /api/dashboard/stats-by-app`

Devuelve por cada `appId`:
- Total mensajes (hoy, esta semana, este mes)
- Mensajes pagos (con `pricingCategory` no vacío, o status delivered/read que son cobrados)
- Desglose por categoría: utility, marketing, authentication

```json
{
  "apps": [
    {
      "appId": "heartlink",
      "name": "HeartLink",
      "today": { "total": 45, "paid": 42 },
      "week": { "total": 312, "paid": 298 },
      "month": { "total": 1200, "paid": 1150 }
    }
  ]
}
```

### 3. Vista dashboard: sección por app

- **Tarjetas por app**: Cada app en su propia tarjeta con totales y mensajes pagos.
- **Selector de app**: Mantener filtro actual (tabla detallada).
- **Gráfico opcional**: Barras por app comparando mensajes pagos del mes.

### 4. Mapeo appId ↔ tenantId (si aplica)

Si `appId` en `whatsappMessages` equivale a `tenantId` (heartlink, nautica, etc.), se pueden:
- Mostrar el `name` del tenant en vez del ID.
- Unificar datos de `wa_messages` (entrantes) con `whatsappMessages` (salientes) para una vista completa.

---

## Orden de implementación sugerido

| Paso | Descripción |
|------|-------------|
| 1 | Extender webhook para guardar `pricingCategory` en `whatsappMessages` |
| 2 | Crear API `GET /api/dashboard/stats-by-app` con agregación por appId |
| 3 | Actualizar la UI del dashboard con tarjetas por app y contadores de mensajes pagos |
| 4 | (Opcional) Gráfico de barras mensajes pagos por app |
| 5 | (Opcional) Integrar nombres de `tenants` para mostrar "HeartLink" en vez de "heartlink" |

---

## Notas técnicas

- **Pricing de Meta**: utility, marketing, authentication son cobrados; "service" / respuesta usuario suele ser gratuita en ventana 24h.
- **Index Firestore**: Ya existe índice en `whatsappMessages` por `(appId, createdAt)`. Para stats por período podría hacerse agregación en memoria (últimos 100–500 docs) o considerar Cloud Functions + colección de agregados.
- **Rendimiento**: Para muchas apps o alto volumen, considerar pre-agregar en una colección `dashboard_daily_stats` por `(appId, date)` con un job nocturno.
