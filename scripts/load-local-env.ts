import { config } from "dotenv";
import path from "node:path";

/** Carga .env.local y .env — importar este módulo antes que firebase-admin en scripts tsx. */
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });
