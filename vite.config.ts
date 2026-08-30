import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(),VitePWA({
    registerType:'autoUpdate',
    includeAssets:['nodo-icon.svg'],
    manifest:{
      name:'NODO Agro · Inteligencia Operativa',short_name:'NODO Agro',description:'Gemelo digital operativo para establecimientos agropecuarios.',
      theme_color:'#151b14',background_color:'#edf0e9',display:'standalone',orientation:'any',scope:'/',start_url:'/',lang:'es-AR',
      icons:[{src:'/nodo-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'},{src:'/nodo-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'maskable'}],
    },
    workbox:{
      globPatterns:['**/*.{js,css,html,svg,woff2}'],cleanupOutdatedCaches:true,navigateFallback:'/index.html',
      navigateFallbackDenylist:[/^\/auth\//,/^\/functions\//,/^\/rest\//,/^\/storage\//],runtimeCaching:[],
    },
  })],
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules\\react')) return 'react';
          if (id.includes('@supabase') || id.includes('@tanstack') || id.includes('node_modules/zod')) return 'data';
          if (id.includes('lucide-react')) return 'icons';
          return undefined;
        },
      },
    },
  },
});
