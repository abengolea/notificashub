/**
 * POST /api/internal/send
 *
 * Alias de /api/whatsapp/send para clientes que llaman con esta ruta (ej. Regatas+).
 * Mismo cuerpo: texto o plantilla Meta; headers x-internal-token o x-internal-secret; opcional x-tenant-id.
 */
export { POST } from "@/app/api/whatsapp/send/route";
