# Diagnóstico: WhatsApp de NotificasHub no responde

**Caso:** Usuario envía mensajes desde 3364645357 (wa_id: 5493364645357). WhatsApp de NotificasHub no responde nada.

**Instrucciones:** Este documento es para otra IA. Solo realizar análisis/diagnóstico. NO hacer cambios en código. Solo proponer hipótesis y pasos de verificación.

---

## 1. Hallazgo CRÍTICO: dos implementaciones de webhook

Existen **dos rutas** para el mismo endpoint `/api/whatsapp/webhook`:

| Ubicación | Lógica | Comportamiento |
|-----------|--------|----------------|
| `app/api/whatsapp/webhook/route.ts` | `handleIncomingWebhook` → `processInbound` | Flujo multi-tenant: idempotencia, resolveTenant, user_memberships, ask_choice, route |
| `src/app/api/whatsapp/webhook/route.ts` | Lógica antigua inline | Reenvía directo a HeartLink si `HEARTLINK_URL` y `INTERNAL_SECRET` existen. **No usa** user_memberships, resolveTenant, ask_choice |

**Next.js** con `app/` y `src/app/` puede resolver rutas de forma ambigua. **Debe verificarse cuál ruta se está sirviendo** en el despliegue (Firebase App Hosting). Si se sirve `src/app/`, el flujo multi-tenant nunca se ejecuta.

---

## 2. Flujo correcto (cuando se usa `app/`)

```
Meta POST → app/api/whatsapp/webhook/route.ts
  → handleIncomingWebhook(db, body)
  → processInbound(db, body)
    → extractIncomingMessages(body)   ← Si [] → no se procesa nada
    → Para cada mensaje:
      → claimInboundMessage(db, messageId, ...)  ← Si duplicate → continue
      → resolveTenantForIncomingMessage(db, from, incoming)
        → getMemberships(db, sanitizePhone(from))  ← Si null → silent_unregistered
        → Si tenantIds.length > 1: ask_choice o route según session/lastTenant/pending
        → Si tenantIds.length === 1: route
      → ask_choice → sendInteractiveList(from, ...) o sendText(...)
      → route → fetch(tenant.webhookUrl, ...)
```

---

## 3. Causas posibles de “no responde”

### 3.1 Meta no llama al webhook
- URL en Meta Business Suite incorrecta.
- Firebase App Hosting: URL puede ser `https://notificashub--studio-3864746689-59018.us-east4.hosted.app` (u otra variante). Confirmar qué URL tiene configurada Meta.
- Firewall / CORS: poco probable para POST desde Meta.

### 3.2 extractIncomingMessages devuelve []
- El schema Zod en `validate.ts` (metaMessageSchema) solo acepta: `text`, `interactive`, `image`, `audio`, `video`, `document`, `button`, `contacts`.
- **Tipos no soportados:** `sticker`, `reaction`, `location`, `order`, etc. Si el usuario envió sticker/reacción, el mensaje se descarta.
- Estructura del payload de Meta distinta a la esperada.

### 3.3 Duplicados (claimInboundMessage)
- Si el mensaje ya existe en `wa_messages`, se descarta sin responder.
- Posible si Meta reenvía webhooks o si hay duplicados en la cola.

### 3.4 silent_unregistered
- `getMemberships(db, sanitizePhone(from))` devuelve null.
- Clave esperada: `user_memberships/5493364645357` (sanitizePhone reemplaza no-alfanuméricos por `_`; "5493364645357" no cambia).
- Si el documento tiene otra clave (ej. con guiones o formato distinto) no se encuentra.

### 3.5 silent_or_handoff
- Usuario multi-tenant en estado `pending` que envió ≥2 mensajes no válidos (ni "1"/"2" ni selección correcta).
- Se borra pending y no se responde más.

### 3.6 Fallo en sendInteractiveList / sendText
- `sender.ts` usa `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_ACCESS_TOKEN`.
- Si fallan, se registra en `result.errors` pero el webhook responde 200 a Meta.
- Revisar variables de entorno en el despliegue.

### 3.7 Ruta duplicada sirve la implementación antigua
- Si `src/app/` tiene precedencia y falta `HEARTLINK_URL` o `INTERNAL_SECRET` en producción, el webhook antiguo no reenvía y no responde.

---

## 4. Archivos clave

| Archivo | Función |
|---------|---------|
| `app/api/whatsapp/webhook/route.ts` | Handler principal (multi-tenant) |
| `src/app/api/whatsapp/webhook/route.ts` | Handler alternativo (HeartLink directo) – **posible conflicto** |
| `src/whatsapp/process-inbound.ts` | Orquesta idempotencia, resolve, route/send |
| `src/whatsapp/validate.ts` | `extractIncomingMessages` (Zod), `parseNumericChoice`, `parseInteractiveChoiceId` |
| `src/whatsapp/resolve-tenant.ts` | `resolveTenantForIncomingMessage` |
| `src/whatsapp/idempotency.ts` | `claimInboundMessage` |
| `src/whatsapp/firestore.ts` | `sanitizePhone`, `getMemberships`, `getSession`, `getLastTenant`, etc. |
| `src/whatsapp/sender.ts` | `sendText`, `sendInteractiveList` |
| `lib/webhook-debug.ts` | `lastWebhook`, `lastMessageWebhook` |

---

## 5. Endpoints de diagnóstico

- `GET /api/whatsapp/last-webhook` – Último webhook recibido (metadatos).
- `GET /api/whatsapp/test-heartlink` – Test de conexión con HeartLink.

*(Existe duplicado de last-webhook en `app/` y `src/app/`.)*

---

## 6. Scripts útiles

```bash
npm run debug-phone -- 5493364645357   # Revisa user_memberships
npm run verificar-setup                # Revisa tenants
npm run force-ask-choice -- 5493364645357  # Borra session/lastTenant para forzar ask_choice
```

---

## 7. Pasos de verificación sugeridos

1. **Confirmar recepción del webhook**
   - Revisar logs de Firebase (Cloud Run / App Hosting).
   - Llamar a `/api/whatsapp/last-webhook` justo después de enviar un mensaje.
   - Si `at` es reciente y `hasMessage: true`, el webhook está llegando.

2. **Verificar qué ruta se sirve**
   - Buscar en logs la presencia de `[NotificasHub] Router:` (multi-tenant) o `[NotificasHub] Reenviando a HeartLink:` (antigua).
   - Si no hay ninguno, puede que no se esté ejecutando la lógica de mensajes.

3. **Confirmar existencia de membership**
   - Ejecutar `npm run debug-phone -- 5493364645357`.
   - Verificar que exista `user_memberships/5493364645357` con `tenantIds` correctos.

4. **Tipo de mensaje**
   - Revisar `lastWebhook.messageType`. Si es `sticker`, `reaction`, etc., puede ser rechazado por Zod.

5. **Variables de entorno en producción**
   - `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `HEARTLINK_URL`, `INTERNAL_SECRET`.

6. **Resolver conflicto app/ vs src/app/**
   - Eliminar el webhook duplicado en `src/app/api/whatsapp/` para evitar ambigüedad.
   - Mantener solo la implementación multi-tenant en `app/`.

---

## 8. Datos del usuario de prueba

- Teléfono: 3364645357
- wa_id Meta: 5493364645357
- Clave Firestore esperada: `user_memberships/5493364645357`
- tenantIds configurados: `["heartlink", "WZAf1Mw08Uq047wneIxI"]` (HeartLink + Náutica)
- `force-ask-choice` ya ejecutado (se borró `wa_last_tenant`)

---

---

## 9. Causa raíz confirmada (resuelta)

**Error:** `send ask_choice: WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN son requeridos`

- `apphosting.yaml` tenía `PHONE_NUMBER_ID` (nombre incorrecto) y no tenía `WHATSAPP_ACCESS_TOKEN`.
- **Solución aplicada:** Se agregaron `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_ACCESS_TOKEN` (secret) en `apphosting.yaml`.
- **Paso pendiente:** Crear el secret `whatsapp-access-token` en Secret Manager y hacer grant al backend.

---

*Documento generado para diagnóstico. No realizar cambios sin autorización.*
