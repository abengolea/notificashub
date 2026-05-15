/**
 * Actualiza el nombre del perfil de WhatsApp Business a "Notificas".
 * Usa la API de Meta (Graph API) con las credenciales de .env.local o .env
 *
 * Uso:
 *   npm run update-whatsapp-profile
 *   npx tsx scripts/update-whatsapp-profile.ts
 *
 * Requiere: WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN en el entorno
 * (o en .env.local / .env)
 *
 * Nota: El display name puede requerir aprobación de Meta. Si el API devuelve
 * error, cambiá el nombre manualmente en:
 * Meta Business Suite → WhatsApp Manager → Phone numbers → [tu número] → Display name
 */
import { config } from "dotenv";

// Cargar .env.local (Next.js) o .env
config({ path: ".env.local" });
config();

const GRAPH_API = "https://graph.facebook.com/v21.0";
const DISPLAY_NAME = "Notificas";

async function main() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.error("Error: Faltan variables de entorno.");
    console.error("Configurá WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN");
    console.error("en .env.local o en tu entorno.");
    console.error("");
    console.error("Ejemplo en .env.local:");
    console.error("  WHATSAPP_PHONE_NUMBER_ID=123456789012345");
    console.error("  WHATSAPP_ACCESS_TOKEN=EAAxxxxx...");
    process.exit(1);
  }

  const url = `${GRAPH_API}/${phoneNumberId}/whatsapp_business_profile`;
  // messaging_product es requerido. about = texto bajo la foto. name = display name (puede no estar soportado).
  const body: Record<string, string> = {
    messaging_product: "whatsapp",
    about: "Notificas - Centro de mensajería",
    name: DISPLAY_NAME, // Intentamos; si Meta lo rechaza, cambiar manualmente en WhatsApp Manager
  };

  console.log("Actualizando perfil de WhatsApp Business...");
  console.log(`  URL: ${url}`);
  console.log(`  Nombre (display): ${DISPLAY_NAME}`);
  console.log(`  About: Notificas - Centro de mensajería`);
  console.log("");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (res.ok) {
    console.log("✅ Perfil actualizado correctamente.");
    console.log("   Los contactos deberían ver 'Notificas' como nombre.");
  } else {
    console.error("❌ Error al actualizar el perfil:");
    console.error(`   Status: ${res.status}`);
    console.error("   Respuesta:", JSON.stringify(data, null, 2));
    console.error("");
    console.error("Si Meta rechaza 'name' por API, cambiá el display name manualmente:");
    console.error("  Meta Business Suite → WhatsApp Manager → Phone numbers");
    console.error("  → Seleccioná tu número → Display name → Editar");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
