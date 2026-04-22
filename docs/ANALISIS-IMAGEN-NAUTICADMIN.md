# Análisis profundo: Imagen no llega a NauticAdmin

**Para:** IA que debe explorar hipótesis o implementar solución  
**Contexto:** NotificasHub reenvía mensajes WhatsApp a tenants (HeartLink, NauticAdmin). Los mensajes de texto funcionan. Las imágenes no llegan a NauticAdmin; el usuario no recibe respuesta.

---

## 1. Arquitectura del flujo

```
Meta (WhatsApp Cloud API)
    │ POST /api/whatsapp/webhook (mensajes entrantes)
    ▼
NotificasHub (Next.js en Firebase App Hosting / Cloud Run)
    │ 1. Parse body
    │ 2. extractIncomingMessages(body) → Array<{message, from, contactName, value}>
    │ 3. Para cada mensaje:
    │    - claimInboundMessage (idempotencia en wa_messages)
    │    - resolveTenantForIncomingMessage → "route" | "ask_choice" | ...
    │    - Si route → getTenantInfo (webhookUrl, internalSecret)
    │    - Si image/document: downloadMediaFromMeta(mediaId) → base64
    │    - fetch(tenant.webhookUrl, { body: payload con imageBase64 })
    │    - Si falla → sendText("Te conectamos con... escribinos de nuevo")
    ▼
NauticAdmin (tenant WZAf1Mw08Uq047wneIxI)
    │ POST /api/whatsapp/incoming
    │ Responde llamando POST /api/whatsapp/send
    ▼
Usuario recibe respuesta por WhatsApp
```

---

## 2. Lo que SÍ funciona

| Evento | Resultado |
|--------|-----------|
| Usuario envía texto "Marinas del Yaguron" | NotificasHub reenvía a NauticAdmin ✓ |
| NauticAdmin recibe y responde "Hola... ¿Querés cargar un pago?" | Usuario recibe ✓ |
| Usuario envía "si" | NotificasHub reenvía ✓ |
| NauticAdmin responde "Perfecto... Enviá la imagen o PDF" | Usuario recibe ✓ |
| Usuario envía **imagen** (captura de pantalla) | **Usuario no recibe NADA** ✗ |

**Conclusión:** El webhook funciona (textos llegan y se procesan). El problema es específico del flujo cuando el mensaje es tipo `image`.

---

## 3. Estructura esperada del webhook de Meta para imagen

Según WhatsApp Cloud API, un mensaje de imagen llega como:

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "...",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "...", "phone_number_id": "..." },
        "contacts": [{ "wa_id": "549...", "profile": { "name": "..." } }],
        "messages": [{
          "id": "wamid.xxx",
          "from": "5493364645357",
          "timestamp": "1234567890",
          "type": "image",
          "image": {
            "id": "MEDIA_ID_FROM_META",
            "mime_type": "image/jpeg",
            "sha256": "..."
          }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

El usuario envía una **captura de pantalla** (no sticker); debería llegar como `type: "image"`.

---

## 4. Puntos de fallo posibles

### A. Extracción (extractIncomingMessages)

**Archivo:** `src/whatsapp/validate.ts`

- `webhookBodySchema.safeParse(body)` puede fallar si el body tiene estructura inesperada.
- `metaMessageSchema.safeParse(message)` puede rechazar si:
  - Falta `id`, `from`, `timestamp` (requeridos).
  - `type` no está en el enum (ahora: text, interactive, image, audio, video, document, button, contacts, sticker).
  - `image` no cumple `metaMediaSchema` (requiere `id` como string).

**Logs añadidos:**
- `[validate] metaMessageSchema rechazó mensaje:` + tipo + issues de Zod.
- `[NotificasHub] Mensajes en payload pero extractIncomingMessages=0:` si hay mensajes en body pero extracted.length === 0.

### B. Idempotencia (claimInboundMessage)

**Archivo:** `src/whatsapp/idempotency.ts`

- Si el mismo `messageId` ya existe en `wa_messages`, retorna `{ claimed: false }` y se hace `continue` sin procesar.
- **Hipótesis:** Meta podría enviar el webhook de la imagen múltiples veces; la primera request podría fallar o no completarse, y un reintento marcaría el mensaje como duplicado. Pero en ese caso la primera debería haber procesado.

### C. Resolución de tenant (resolveTenantForIncomingMessage)

**Archivo:** `src/whatsapp/resolve-tenant.ts`

- Para un mensaje de imagen sin `textBody`, `interactive`, `referral` ni `numericChoice`, el tenant se resuelve por **sesión** o **lastTenant**.
- Si la sesión existe y `activeTenantId === WZAf1Mw08Uq047wneIxI`, retorna `{ action: "route", tenantId }`.
- **Hipótesis:** ¿Podría un mensaje de imagen no tener `from` o tener un formato distinto que rompa la resolución? Poco probable si Meta envía la misma estructura.

### D. Descarga de media (downloadMediaFromMeta)

**Archivo:** `src/whatsapp/media-download.ts`

- Requiere `message.image.id` (extraído por `getMediaIdFromMessage`).
- Hace `GET https://graph.facebook.com/v21.0/{mediaId}` con `WHATSAPP_ACCESS_TOKEN`.
- Luego descarga la URL temporal y convierte a base64.
- Si falla 3 veces, retorna `null` → se envía "No pudimos procesar el archivo" al usuario.
- **Hipótesis:** Si la descarga falla, el usuario SÍ debería recibir ese mensaje. Si no recibe nada, o no llegamos a este punto o hay un error antes.

### E. Reenvío al tenant (fetch webhookUrl)

**Archivo:** `src/whatsapp/process-inbound.ts`

- Si `tenant.webhookUrl` o `tenant.internalSecret` faltan → log `Tenant sin webhookUrl`, no se reenvía, se envía fallback.
- Si el POST falla (res.ok false) → log `POST a tenant falló`, se envía fallback.
- Si hay excepción en fetch → se envía fallback.

### F. Timeout de Meta

- Meta espera respuesta 200 en ~5–10 segundos.
- La descarga de imagen + POST a NauticAdmin puede tardar más.
- Si hay timeout, Meta podría desconectar antes de que terminemos. **Pero** un timeout normalmente dejaría logs de error; el usuario no reporta errores visibles.

---

## 5. Lo que NO se ve en los logs (crítico)

Cuando el usuario envía imagen, en los logs aparecen:

- `[webhook] Mensaje no encontrado para status:` (status updates de Meta)
- `[NotificasHub] Router: { processed: 1 }`
- `[NotificasHub] Route via session: WZAf1Mw08Uq047wneIxI`
- `POST /api/whatsapp/send` (NauticAdmin respondiendo)

**Pero NO aparecen:**

- `[webhook] RECIBIDO` con `firstType: 'image'`
- `[webhook] INBOUND mensajes` con `types: ['image']`
- `[webhook] INBOUND MEDIA:`
- `[NotificasHub] Mensaje type: image`
- `[NotificasHub] Media recibida`
- `[NotificasHub] imageBase64 añadido`
- `[NotificasHub] Reenviando a tenant con media`
- `[NotificasHub] POST a tenant falló`
- `[NotificasHub] Tenant sin webhookUrl`
- `[NotificasHub] No se pudo reenviar`

**Interpretación:** Los logs con `Router: processed 1` y `Route via session` parecen corresponder a mensajes de **texto** (ej. "si"), no a la imagen. La imagen podría estar llegando en una **request distinta** que no se está viendo o que no dispara esos logs.

---

## 6. Hipótesis a explorar

### H1: El webhook de la imagen tiene estructura distinta

- Meta podría enviar la imagen en un `change` o `entry` diferente.
- El log `[webhook] RECIBIDO` solo mira `body.entry[0].changes[0].value.messages[0]`. Si la imagen viene en otro índice, no se registra.
- **Acción:** Loggear el body completo (o al menos todos los `entry[].changes[].value.messages`) cuando `body.entry` existe. Ver si hay múltiples POST y cuál trae la imagen.

### H2: Meta envía la imagen con un tipo no soportado

- Por ejemplo `type: "image"` con `image` en otro formato, o un tipo no documentado.
- **Acción:** Revisar la docs de Meta. Hacer el schema más permisivo (p.ej. `type: z.string()` en lugar de enum) o loggear el tipo cuando falla el parse.

### H3: La imagen llega pero extractIncomingMessages retorna []

- Zod rechaza el mensaje.
- **Acción:** El log `[validate] metaMessageSchema rechazó mensaje` debería indicarlo. Si no aparece, el mensaje podría no estar en `value.messages` o el body podría no pasar `webhookBodySchema`.

### H4: La imagen llega como mensaje duplicado

- La primera request falla (timeout, error). Meta reintenta. La segunda es duplicado y se ignora.
- **Acción:** Revisar `wa_messages` para ver si existe un doc con `type: "image"` para el `messageId` de la imagen. Si existe, la primera request sí procesó algo (aunque no completara la respuesta al usuario).

### H5: Colección incorrecta para status

- El código busca status en `whatsappMessages` pero la idempotencia usa `wa_messages`. Los status updates no encuentran el mensaje. Esto no explica que la imagen no llegue, pero puede generar ruido en los logs.

### H6: Múltiples deployments / URLs

- ¿Hay más de una URL de webhook configurada en Meta? ¿El tráfico de imágenes va a otra instancia antigua?
- **Acción:** Verificar en Meta Developer Console la URL del webhook y que solo haya una.

### H7: Imagen en un batch con statuses

- Meta puede enviar `value.messages` y `value.statuses` en el mismo POST.
- **Acción:** La iteración actual debería procesar ambos. Revisar si hay lógica que descarte mensajes cuando hay statuses.

### H8: Problema de campo `context` o reply

- Si la imagen es "respuesta" a otro mensaje, Meta puede enviar `context: { message_id: "..." }`.
- **Acción:** Verificar que el schema y el procesamiento manejen `context` correctamente para mensajes de imagen.

---

## 7. Archivos clave

| Archivo | Función |
|---------|---------|
| `app/api/whatsapp/webhook/route.ts` | Entry point; parse body, logs, llama handleIncomingWebhook |
| `src/whatsapp/webhook-handler.ts` | Llama processInbound |
| `src/whatsapp/process-inbound.ts` | Loop sobre extracted; claim, resolve, download media, fetch tenant |
| `src/whatsapp/validate.ts` | extractIncomingMessages, metaMessageSchema |
| `src/whatsapp/media-download.ts` | downloadMediaFromMeta, getMediaIdFromMessage |
| `src/whatsapp/tenants.ts` | getTenantInfo (webhookUrl, internalSecret) |
| `src/whatsapp/idempotency.ts` | claimInboundMessage (wa_messages) |

---

## 8. Próximos pasos recomendados

1. **Desplegar** los cambios actuales (logs de diagnóstico) y enviar **solo una imagen**. Buscar en los logs, en orden:
   - `[webhook] RECIBIDO` con `firstType`
   - `[webhook] INBOUND mensajes` con `types`
   - `[NotificasHub] Mensajes en payload pero extractIncomingMessages=0`
   - `[validate] metaMessageSchema rechazó`
   - `[NotificasHub] Mensaje type: image`

2. **Persistir el último webhook con imagen:** Si llega, guardar en Firestore o en un log estructurado un snapshot del body (sanitizado) para análisis posterior.

3. **Probar con una imagen pequeña** para descartar timeouts por tamaño.

4. **Revisar Firestore** `tenants/WZAf1Mw08Uq047wneIxI`: confirmar que existe `webhookUrl` e `internalSecret`.

5. **Simular localmente:** Enviar un POST al webhook con un payload de imagen de ejemplo (según docs de Meta) y seguir el flujo con breakpoints o logs.
