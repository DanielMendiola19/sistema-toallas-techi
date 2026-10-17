// Configuración compartida: localhost en desarrollo y Render en producción.
// En Render (Static Site), configura VITE_API_URL con la URL pública del backend
// SIN /api al final; por ejemplo https://toallas-techi-api.onrender.com
const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
export const BACKEND_URL = (configured || 'http://localhost:3000').replace(/\/+$/, '');
export const API = `${BACKEND_URL}/api`;
export const IMAGE_BASE = `${BACKEND_URL}/product-images`;
