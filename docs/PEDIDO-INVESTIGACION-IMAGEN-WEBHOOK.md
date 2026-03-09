# Pedido de investigación: Imagen no llega por webhook de WhatsApp

## Resumen del problema

**Sistema:** NotificasHub — router multi-tenant que recibe webhooks de WhatsApp (Meta Cloud API) y reenvía mensajes a backends de clientes (ej. NauticAdmin).

**Síntoma:** Los mensajes de **texto** funcionan bien: el usuario escribe, el sistema responde. Las **imágenes** no llegan al backend del cliente; el usuario no recibe respuesta al enviar una captura o foto.

**Hipótesis descartadas hasta ahora:**
- ❌ Configuración del webhook en Meta (los textos llegan, la URL es correcta)
- ❌ Filtro por tipo en `extractIncomingMessages` (el schema acepta `image`, `document`, `sticker`)
- ❌ Bug en el parsing (tests unitarios con payload mock de imagen pasan)

**Observación clave en logs de producción:**

Cuando el usuario envía una imagen, solo aparecen webhooks con:
- `messageCount: 0`
- `messageTypes: []`
- `hasStatuses: true`

Es decir: **solo llegan webhooks de status** (delivered, read, etc.), **nunca** uno con `value.messages` conteniendo la imagen.

Nunca aparece:
- `[webhook] *** INCOMING MESSAGE ***`
- `[msg] received`
- Ni ningún log del pipeline de procesamiento de imagen

**Estructura que esperamos** (según WhatsApp Cloud API):
```json
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "id": "wamid.xxx",
          "type": "image",
          "image": { "id": "MEDIA_ID", "mime_type": "image/jpeg" }
        }]
      }
    }]
  }]
}
```

**Lo que llega** (según logs): webhooks con `value.statuses` pero sin `value.messages`, o con `value.messages` vacío.

---

## Pregunta para investigar

**¿Por qué Meta enviaría solo webhooks de status para un mensaje de imagen, pero nunca el webhook con el mensaje en sí?**

Posibles líneas a investigar:

1. **¿Meta envía mensaje e imagen en el mismo POST que los statuses?**  
   Si es así, ¿podría la estructura ser distinta (ej. `value` con keys diferentes, otra anidación)?

2. **¿Existe algún caso en que Meta no envíe el webhook del mensaje para imágenes?**  
   Por ejemplo: límites, permisos, tipos de cuenta, versión de la API.

3. **¿La estructura del webhook para `type: "image"` difiere de la de `type: "text"`?**  
   ¿Hay documentos o ejemplos donde la imagen venga en otro path o formato?

4. **¿Hay diferencias de comportamiento entre envíos desde distintos clientes?**  
   Por ejemplo: app móvil vs web, captura de pantalla vs foto de cámara.

5. **¿Puede existir un timeout o error previo al logging?**  
   El handler responde 200; si el request fallara antes de los logs, ¿qué evidencia habría en Cloud Run / Meta?

---

## Contexto técnico

- **Stack:** Next.js en Firebase App Hosting (Cloud Run)
- **Endpoint:** `POST /api/whatsapp/webhook`
- **Flujo:** `req.json()` → log summary → `extractIncomingMessages(body)` → idempotencia → resolve tenant → descarga media → POST al tenant
- **Extraction:** `body.entry[].changes[].value.messages[]` con schema Zod que incluye `image`, `document`, `sticker`

---

## Lo que se necesita

Que investigues en documentación oficial de Meta/WhatsApp Cloud API, ejemplos de webhooks, issues en GitHub, Stack Overflow o foros, y reportes:

1. Causas conocidas por las que un webhook de imagen no llegaría o no tendría `value.messages`.
2. Diferencias de estructura entre webhooks de texto e imagen.
3. Pasos concretos para reproducir o verificar el envío de imágenes vía webhook.
4. Si existe algún requisito o configuración adicional para recibir webhooks de media.

**Objetivo:** Encontrar por qué no recibimos el webhook con la imagen, sabiendo que los mensajes de texto sí llegan correctamente.

---

## Actualización: implementación de diagnóstico (Causa #1)

Según el análisis externo, la causa más probable es que **`req.json()` falle o consuma el body antes del log**. Se implementó:

1. **Leer body como `req.text()`** antes de cualquier parsing
2. **Log `[webhook-raw]`** con: `len`, `hasMessages`, `hasImage`, `hasStatuses`, `preview`
3. **`JSON.parse(rawText)`** en try/catch separado — si falla, log explícito

Si `hasImage: true` aparece en logs cuando el usuario manda foto → el body SÍ llega, el bug está en el parsing posterior.  
Si nunca aparece ese log → el handler no se ejecuta o falla antes del `await req.text()`.
