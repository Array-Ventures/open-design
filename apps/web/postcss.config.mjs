import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const fontPolicy = JSON.parse(readFileSync(new URL('./embedded-fonts.json', import.meta.url), 'utf8'));
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    ...(process.env.OD_EMBEDDED_STUDIO === "1" ? { [fileURLToPath(new URL("./postcss-embedded-fonts.cjs", import.meta.url))]: { basePath: process.env.OD_STUDIO_BASE_PATH ?? "/studio", fonts: fontPolicy.fonts } } : {}),
  },
};

export default config;
