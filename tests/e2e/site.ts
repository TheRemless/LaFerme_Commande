// Adresse du serveur de test (playwright.config.ts) : le port se règle avec PORT_E2E.
export const SITE = `http://localhost:${process.env.PORT_E2E ?? 3200}`;
