# NotificasHub

Hub central para WhatsApp Cloud API (Meta) con soporte **multi-tenant**. Enruta mensajes entrantes al tenant correcto según membresías, referral tokens y preferencias del usuario.

## WhatsApp Router multi-tenant

### Flujo

1. **Mensaje entrante** → Webhook Meta recibe el payload
2. **Idempotencia** → Se verifica `wa_messages` por `message.id`; si existe, se ignora (Meta reintenta)
3. **Resolución de tenant** → `resolveTenant(phone, message)` determina la acción
4. **Acciones**:
   - `silent_unregistered`: Número no registrado → no responder (auditoría sí)
   - `silent_or_handoff`: Máx intentos en ask_choice superados → silencio
   - `route`: Enviar mensaje al webhook del tenant (HeartLink, Náutica, etc.)
   - `ask_choice`: Usuario con 2+ tenants → enviar lista "¿Por cuál servicio consultás?"

### Variables de entorno

```bash
# WhatsApp Cloud API (Meta)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=notificas_webhook_2026

# Firebase Admin
GOOGLE_APPLICATION_CREDENTIALS=  # ruta al JSON de clave privada

# Tenants (fallback para HeartLink si no está en Firestore)
HEARTLINK_URL=https://heartlink--heartlink-f4ftq.us-central1.hosted.app
INTERNAL_SECRET=heartlink_internal_2026

# Opcional: primer contacto sin user_memberships → enrutar a este tenant (ej. planesdeahorro)
# DEFAULT_INBOUND_TENANT_ID=planesdeahorro

# Opcional: Regatas+ u otros tenants con imágenes (URL firmada). Si no se define, se usa {projectId}.appspot.com
# FIREBASE_STORAGE_BUCKET=studio-3864746689-59018.appspot.com
```

### Modelo de datos (Firestore)

| Colección          | Documento       | Campos principales                                           |
|--------------------|------------------|--------------------------------------------------------------|
| `tenants`          | tenantId         | name, status, referralTokens[], webhookUrl, internalSecret, optional: internalAuthHeader, webhookPayloadFormat  |
| `user_memberships` | phone_sanitized  | phone, tenantIds[], updatedAt                               |
| `wa_sessions`      | sessionKey       | phone, conversationId?, activeTenantId, state, expiresAt      |
| `wa_messages`      | messageId (Meta) | direction, phone, tenantId?, payload, createdAt, pricingCategory |
| `wa_pending_choices` | phone_sanitized | options[], expiresAt (10 min), attempts                       |
| `wa_last_tenant`   | phone_sanitized  | tenantId, updatedAt (vence lógico 30 días)                   |

### Ejemplos wa.me con texto prefijado

- `https://wa.me/5491112345678?text=RIVER` → usuario entra con "RIVER" → inferir Escuela River
- `https://wa.me/5491112345678?text=NAUTICA` → inferir Náutica
- `https://wa.me/5491112345678?text=HEARTLINK` → inferir HeartLink

Configurar `referralTokens` en cada tenant en Firestore (ej. `["RIVER", "ESCUELA_RIVER"]`).

### Despliegue

```bash
npm run build
# Deploy a Firebase App Hosting / Cloud Run / Vercel
firebase deploy
```

El webhook debe estar accesible en `https://tu-dominio/api/whatsapp/webhook`.

### Tests

```bash
npm run test        # una vez
npm run test:watch  # modo watch
```

### Setup inicial Firestore

Para activar el router, creá documentos en Firestore:

**1. Tenant (ej. HeartLink)** en `tenants/heartlink`:
```json
{
  "name": "HeartLink",
  "status": "active",
  "referralTokens": ["HEARTLINK", "HEART"],
  "webhookUrl": "https://heartlink--heartlink-f4ftq.us-central1.hosted.app/api/whatsapp/incoming",
  "internalSecret": "heartlink_internal_2026"
}
```

**2. Membresía de usuario** en `user_memberships/5491112345678` (phone_sanitized: reemplazar `+` y espacios por `_`):
```json
{
  "phone": "5491112345678",
  "tenantIds": ["heartlink"],
  "updatedAt": "<timestamp>"
}
```

Si el usuario tiene varios tenants: `"tenantIds": ["heartlink", "nautica", "river"]`.

### Regatas+ (tenant `regatas`)

Firestore `tenants/regatas` (crear/actualizar con `npm run setup-tenant-regatas`):

```json
{
  "name": "Regatas+",
  "status": "active",
  "referralTokens": ["REGATAS", "REGATAS+"],
  "webhookUrl": "https://gestion-regatas--regatasadmin-3c6ee.us-east4.hosted.app/api/whatsapp/incoming",
  "internalSecret": "regatas_internal_2026",
  "internalAuthHeader": "x-internal-secret",
  "webhookPayloadFormat": "regatas_plus"
}
```

- Entrantes: NotificasHub POST al `webhookUrl` con header `x-internal-secret` y cuerpo `{ phone, tenantId, waMessageId, message }` (texto o imagen con `imageUrl` vía URL firmada en Storage si configurás `FIREBASE_STORAGE_BUCKET`).
- Salientes: Regatas+ puede llamar `POST {NOTIFICASHUB_URL}/api/internal/send` o `POST .../api/whatsapp/send` con header `x-internal-secret` (o `x-internal-token`), opcional `x-tenant-id: regatas`, body **texto** `{ "to": "549...", "text": "..." }` o **plantilla Meta** `{ "to": "549...", "template": { "name": "mi_plantilla", "language": { "code": "es" }, "components": [] } }` (la plantilla debe existir y estar aprobada en el WABA del hub).
- Registro de socios: `POST {NOTIFICASHUB_URL}/api/register-user` con el mismo secreto en `x-internal-secret` o `x-internal-token`, body `{ "phone": "549...", "tenantId": "regatas" }`.

**Rotación del secret:** generá un valor nuevo; actualizá `tenants/regatas.internalSecret` en Firestore, redeploy del hub si hace falta, y **la misma** variable en Regatas+; probá `register-user` y un envío antes de revocar el viejo.

En producción usá un `internalSecret` largo aleatorio, el mismo en Firestore del hub y en `NOTIFICASHUB_INTERNAL_SECRET` (u homónimo) en Regatas+.

**Storage (imágenes hacia Regatas+):** el Admin SDK usa por defecto el bucket `{projectId}.appspot.com` si no definís `FIREBASE_STORAGE_BUCKET`. La cuenta de servicio del deploy necesita permiso de escritura y **signBlob** (URLs firmadas). Si el bucket no existe, crealo en Firebase Console.

**Entrantes Regatas+:** el POST al webhook de Regatas se dispara en segundo plano (no espera la respuesta de Regatas) para no alargar el handler del webhook de Meta; si el POST falla, el hub intenta avisar al usuario por WhatsApp.

### Planes de ahorro (tenant `planesdeahorro` u otro id acordado)

La app **planesdeahorro** expone `POST /api/whatsapp/incoming` y responde al usuario vía `POST {NOTIFICASHUB_URL}/api/whatsapp/send` con `x-internal-token` y `tenantId`. El hub reenvía el payload en formato **meta** (mismo shape que arma `process-inbound.ts`: `message`, `from`, `contactName`, `messageId`, `timestamp`, `tenantId`, `type`, y opcional media en base64).

**Firestore `tenants/{TENANT_ID}`** (el string debe ser el mismo que `NOTIFICASHUB_TENANT_ID` en planesdeahorro):

| Campo | Valor |
|-------|--------|
| `name` | Nombre visible (ej. Planes de ahorro / Dr. Bengolea) |
| `status` | `active` |
| `webhookUrl` | URL absoluta **sin barra final**, ej. `https://<dominio>/api/whatsapp/incoming` |
| `internalSecret` | Secreto largo; **idéntico** a `NOTIFICASHUB_INBOUND_SECRET` en planesdeahorro (no commitear) |
| `webhookPayloadFormat` | `meta` (no usar `regatas_plus` salvo que adapten el body) |
| `referralTokens` | Ej. `PLANES`, `PLANESDEAHORRO`, `EVAL` (primer mensaje / wa.me?text=...) |
| `internalAuthHeader` | Solo si no usan el default del hub (`x-internal-token`) |

**Script (local, con credenciales Admin):**

```bash
npm run setup-tenant-planesdeahorro -- --webhook https://<DOMINIO>/api/whatsapp/incoming
# opcional: --tenant-id planesdeahorro --name "..." --phone 549... --secret <opcional> --auth-header x-internal-token
```

El script imprime el `internalSecret` para copiarlo al entorno seguro de planesdeahorro. Para sumar el tenant a un usuario que ya tiene otros, usá `npm run add-user-to-tenants -- <teléfono> planesdeahorro <otros-ids>`.

**Variables en planesdeahorro (verificación):** `NOTIFICASHUB_URL`, `NOTIFICASHUB_TENANT_ID` (= id del doc en `tenants`), `NOTIFICASHUB_INBOUND_SECRET` (= `internalSecret`). Si configuran otro nombre de header entrante, debe coincidir con `internalAuthHeader` en Firestore.

**Primer contacto sin `user_memberships`:** definí en el hub `DEFAULT_INBOUND_TENANT_ID=planesdeahorro` (env local y en App Hosting / deploy). Así cualquier número nuevo se reenvía a Planes de ahorro sin script de membresía.

**Prueba:** mensaje de texto al WhatsApp del hub (con o sin membresía, según env) → logs del hub POST 200 al `webhookUrl` → planesdeahorro sin 401 → respuesta al usuario vía `/api/whatsapp/send`.

### Consideraciones de cumplimiento

1. **No registrados** → Por defecto no se responde (`silent_unregistered`). Si definís `DEFAULT_INBOUND_TENANT_ID` (mismo string que `tenants/{id}`), esos mensajes se reenvían a ese tenant (útil cuando el canal es solo Planes de ahorro y no querés precargar `user_memberships`). Valorá políticas de WhatsApp / opt-in según tu caso.
2. **Límite de intentos** → Máx 2 reintentos en ask_choice, luego `silent_or_handoff`
3. **Idempotencia** → `claimInboundMessage` guarda en `wa_messages` al recibir; si ya existe, cortar (200 OK sin procesar)
4. **200 OK en < 5 segundos** → Procesamiento inline; para cargas altas considerar cola (Cloud Tasks)
5. **TTL** → wa_sessions 24h, wa_pending_choices 10 min, wa_last_tenant 30 días lógico

---

## Getting Started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api)
