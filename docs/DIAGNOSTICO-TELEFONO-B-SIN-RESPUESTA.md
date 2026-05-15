# Diagnóstico: Teléfono B no recibe respuestas (Marinas del Yagurón)

**Fecha:** 2025-03-05  
**Contexto:** Teléfono A responde OK. Teléfono B (3364522007) envía mensajes y no recibe ninguna respuesta.  
**Tenant:** `WZAf1Mw08Uq047wneIxI` (Marinas del Yagurón)

---

## 1. ¿Existe `user_memberships/{waId}` para el teléfono B?

### Cómo verificarlo (local)

```bash
npm run debug-phone -- 3364522007
# o
npm run debug-phone -- 5493364522007
```

Esto busca en Firestore de NotificasHub el doc con clave `5493364522007` (Meta envía `wa_id` en ese formato).

**Clave esperada:** `user_memberships/5493364522007`  
`sanitizePhone` reemplaza no-alfanuméricos por `_`; para `5493364522007` la clave es exactamente `5493364522007`.

**Requisito:** El doc debe tener `tenantIds` que incluya `WZAf1Mw08Uq047wneIxI`.

---

## 2. ¿Cómo resuelve NotificasHub el tenant?

**Archivo:** `src/whatsapp/resolve-tenant.ts`

1. **Consulta** `user_memberships/{sanitizePhone(from)}` vía `getMemberships(db, phone)`  
   - `from` viene del payload Meta (`message.from` o `contacts[0].wa_id`)
   - La clave es el `wa_id` sanitizado (ej. `5493364522007`)

2. **Si no existe o `tenantIds` está vacío:**
   - Retorna `{ action: "silent_unregistered" }`
   - **No envía ningún mensaje al usuario** (silencio total)

3. **Si tiene 1 tenant:** enruta directo a esa app (`route`).

4. **Si tiene 2+ tenants:** muestra lista para elegir (`ask_choice`) o usa sesión/último tenant si aún válidos.

---

## 3. Flujo cuando el usuario no está registrado

```
webhook recibe mensaje → extractIncomingMessages → claim (idempotencia)
→ resolveTenantForIncomingMessage
   → getMemberships(db, phone) → null o tenantIds vacío
   → return { action: "silent_unregistered" }
→ processInbound: result.processed++; continue;  // sin enviar nada
```

**Resultado:** El usuario no recibe ni mensaje genérico ni handoff. Silencio total.

---

## 4. Cómo debe escribir nauticadmin en `user_memberships`

**Importante:** NotificasHub usa **un solo proyecto Firebase** (`studio-3864746689-59018`).  
`user_memberships`, `tenants`, etc. viven en el Firestore de NotificasHub.

nauticadmin **no debe escribir directamente en Firestore**. Debe llamar a la API de NotificasHub:

```http
POST {NOTIFICASHUB_URL}/api/register-user
Content-Type: application/json
x-internal-token: {INTERNAL_SECRET del tenant WZAf1Mw08Uq047wneIxI}

{ "phone": "3364522007", "tenantId": "WZAf1Mw08Uq047wneIxI" }
```

- `NOTIFICASHUB_URL`: `https://nauticadmin--nauticadmin.us-east4.hosted.app` ❌ (es nauticadmin)  
  Correcto: `https://notificashub--studio-3864746689-59018.us-east4.hosted.app`
- `INTERNAL_SECRET`: el configurado en `tenants/WZAf1Mw08Uq047wneIxI` en Firestore de NotificasHub.

**Si nauticadmin escribe en su propio Firestore** (proyecto distinto), NotificasHub **nunca** verá esos docs.

---

## 5. Proyectos Firebase

| App        | Proyecto Firebase      | Firestore                                      |
|------------|-------------------------|------------------------------------------------|
| NotificasHub | `studio-3864746689-59018` | `user_memberships`, `tenants`, etc.           |
| nauticadmin | (otro proyecto)         | Su propio Firestore si usa Firestore           |

**Sincronización en nauticadmin:**

- Si usa **Firestore SDK** con credenciales de nauticadmin → escribe en Firestore de nauticadmin.
- Si llama **POST /api/register-user** de NotificasHub → escribe en Firestore de NotificasHub ✓

No existen `NOTIFICASHUB_PROJECT_ID`, `NOTIFICASHUB_CLIENT_EMAIL`, etc. en el diseño actual.  
La integración correcta es vía HTTP: `POST {NOTIFICASHUB_URL}/api/register-user`.

---

## 6. Logs cuando el usuario B envía un mensaje

Si el webhook llega a NotificasHub:

- `[webhook] summary`: hasEntry, entriesCount, messageCount, messageTypes, hasStatuses
- `[webhook] *** INCOMING MESSAGE ***` si hay mensajes
- `[msg] received` → `[msg] early-exit` con `step: "silent_unregistered"` si no hay membership

**Si no ves `*** INCOMING MESSAGE ***`:** el webhook con mensajes no está llegando (solo status, etc.).

---

## 7. Checklist de verificación

1. **Ejecutar:** `npm run debug-phone -- 3364522007` en el repo de NotificasHub.
2. **Confirmar** que existe `user_memberships/5493364522007` con `tenantIds` que incluya `WZAf1Mw08Uq047wneIxI`.
3. **En nauticadmin:** ¿la sync usa `POST {NOTIFICASHUB_URL}/api/register-user` o escribe directo en Firestore?
4. **Variables en nauticadmin:** `NOTIFICASHUB_URL` (de NotificasHub, no de nauticadmin) y `INTERNAL_SECRET` del tenant.
5. **Logs de NotificasHub:** al enviar mensaje desde B, buscar `silent_unregistered` o si ni siquiera llega el webhook.

---

## 8. Respuestas concretas

| Pregunta | Respuesta |
|----------|-----------|
| ¿Existe `user_memberships/5493364522007` en Firestore de NotificasHub? | Ejecutar `npm run debug-phone -- 3364522007` para saberlo. |
| ¿Cómo resuelve el tenant? | Consulta `user_memberships/{wa_id_sanitizado}`. Si no existe o tenantIds vacío → `silent_unregistered` (sin respuesta). |
| ¿Qué hace si no encuentra tenant? | **Nada.** No envía mensaje genérico ni handoff. |
| ¿Restricciones Meta (sandbox, etc.)? | El código no aplica restricciones por número. Si el webhook llega, se procesa según membership. |

---

## 9. Acción recomendada si falta el doc

Crear membership manualmente:

```bash
npm run add-user-to-tenants -- 5493364522007 WZAf1Mw08Uq047wneIxI
```

O garantizar que nauticadmin llame correctamente a `POST {NOTIFICASHUB_URL}/api/register-user` al sincronizar WhatsApp.
