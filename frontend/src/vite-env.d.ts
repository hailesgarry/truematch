/// <reference types="vite/client" />

// VitePWA virtual module types (optional safety)
declare module 'virtual:pwa-register' {
	export function registerSW(options?: { immediate?: boolean }): (reload?: boolean) => Promise<void>;
}

