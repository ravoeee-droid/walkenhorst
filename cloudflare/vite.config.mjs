import {defineConfig} from 'vite';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  resolve:{alias:[{find:'@/lib/supabase-browser',replacement:path.resolve(here,'src/client.ts')},{find:'@',replacement:path.resolve(here,'..')},{find:'next/navigation',replacement:path.resolve(here,'src/navigation.tsx')},{find:'next/link',replacement:path.resolve(here,'src/link.tsx')},{find:'crypto',replacement:'node:crypto'}],dedupe:['react','react-dom']},
  publicDir:path.resolve(here,'../public'),
  define:{'process.env.NEXT_PUBLIC_SUPABASE_URL':'window.location.origin','process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('walkenhorst-public-client'),'process.env.NEXT_PUBLIC_SITE_URL':'window.location.origin','process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL':'undefined','process.env.NEXT_PUBLIC_VERCEL_URL':'undefined'},
  esbuild:{jsx:'automatic'},
  ssr:{noExternal:true},
  server:{host:'127.0.0.1',port:5173},
  build:{target:'es2022',outDir:'dist',emptyOutDir:true},
});
