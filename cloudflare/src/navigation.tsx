import {useMemo,useSyncExternalStore} from 'react';
const subscribe=(callback:()=>void)=>{window.addEventListener('popstate',callback);return()=>window.removeEventListener('popstate',callback)};
const snapshot=()=>location.pathname+location.search;
export function useLocation(){return useSyncExternalStore(subscribe,snapshot,snapshot)}
export function navigate(url:string,replace=false){const target=new URL(url,location.href);if(target.origin!==location.origin){location.href=target.href;return}history[replace?'replaceState':'pushState']({},'',target.pathname+target.search+target.hash);window.dispatchEvent(new PopStateEvent('popstate'));window.scrollTo(0,0)}
export function usePathname(){return useLocation().split('?')[0]}
export function useSearchParams(){const url=useLocation();return useMemo(()=>new URLSearchParams(url.split('?')[1]||''),[url])}
export function useParams(){const path=usePathname();return{ id:path.startsWith('/leads/')?decodeURIComponent(path.split('/')[2]):undefined,slug:path.startsWith('/v/')?decodeURIComponent(path.split('/')[2]):undefined}}
export function useRouter(){return useMemo(()=>({push:(url:string)=>navigate(url),replace:(url:string)=>navigate(url,true),refresh:()=>window.dispatchEvent(new PopStateEvent('popstate')),back:()=>history.back(),forward:()=>history.forward(),prefetch:()=>Promise.resolve()}),[])}
export function redirect(url:string){navigate(url,true);return null}
