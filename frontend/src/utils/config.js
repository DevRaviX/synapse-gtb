export const API_BASE = import.meta.env.VITE_API_BASE || '';
export const WS_URL = import.meta.env.VITE_WS_URL || ((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/live');
