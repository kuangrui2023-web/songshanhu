import { mkdir, writeFile } from "node:fs/promises";

const output = new URL("../public/experience/config.js", import.meta.url);
await mkdir(new URL("../public/experience/", import.meta.url), { recursive: true });
const config = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
};
await writeFile(output, `window.__SITE_BACKEND__ = ${JSON.stringify(config)};\n`);
