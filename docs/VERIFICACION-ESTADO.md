# Verificación de estado - NotificasHub

**Fecha:** 2026-03-06

---

## ✅ Lo que está OK

| Ítem | Estado |
|------|--------|
| Secret `whatsapp-access-token` creado en Secret Manager | ✅ |
| Grant access al backend `notificashub` | ✅ |
| `apphosting.yaml` con WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN | ✅ (local) |
| Flujo multi-tenant en `app/api/whatsapp/webhook` | ✅ |
| Webhook de Meta llega correctamente | ✅ (confirmado por logs) |

---

## ⚠️ Falta subir a producción

**Los cambios en `apphosting.yaml` NO están commiteados ni pusheados.**

Si no hacés push, el próximo deploy usará la versión vieja del repo (sin WHATSAPP_PHONE_NUMBER_ID ni WHATSAPP_ACCESS_TOKEN). El WhatsApp seguirá sin responder.

### Pasos para subir

```powershell
cd c:\Users\Adrian\Documents\mis-proyectos\notificas-hub

# Opción A: Solo lo crítico (apphosting)
git add apphosting.yaml
git commit -m "fix: agregar WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN para ask_choice"
git push origin main

# Opción B: Todo lo modificado + docs
git add apphosting.yaml docs/
git add -u
git commit -m "fix: vars WhatsApp + docs diagnóstico y checklist"
git push origin main
```

Después del push, si App Hosting está configurado con auto-deploy desde `main`, se desplegará solo. Si no:

```powershell
firebase apphosting:rollouts:create notificashub
```

---

## 🔧 Recomendación: eliminar webhook duplicado

Existe **src/app/api/whatsapp/webhook/route.ts** (lógica antigua HeartLink-only) que puede conflictear con **app/api/whatsapp/webhook/route.ts** (multi-tenant).

**Recomendación:** Eliminar `src/app/api/whatsapp/webhook/route.ts` para evitar ambigüedad. Los otros en `src/app/api/whatsapp/` (last-webhook, test-heartlink) no duplican rutas en `app/`.

---

## Resumen

| Acción | Prioridad |
|--------|-----------|
| Push de apphosting.yaml (y commit) | **Alta** – Sin esto, WhatsApp no responde |
| Deploy (si no es auto) | Media |
| Eliminar src/app webhook duplicado | Baja (preventivo) |
