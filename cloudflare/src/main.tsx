import React,{Suspense,lazy} from 'react';
import {createRoot} from 'react-dom/client';
import {ApplicationFrame} from '../../components/application-frame';
import {usePathname,navigate} from './navigation';
import '../../app/globals.css';
import '../../app/outbound-ui.css';
import '../../app/sales-os.css';
import '../../app/apple-shell.css';
import '../../app/premium-glass.css';
import '../../app/studio-ux-polish.css';
import '../../app/design-system.css';
import '../../app/lead-production-state.css';
import '../../app/clarity-pass.css';
const modules=import.meta.glob(['../../app/**/page.tsx','!../../app/page.tsx','!../../app/v/**','!../../app/internal/**']);
const routes=Object.entries(modules).map(([path,load])=>({path:path.replace('../../app','').replace('/page.tsx',''),Component:lazy(load as any)}));
if(location.pathname==='/')history.replaceState({},'','/command');
function App(){const path=usePathname();const route=routes.find(x=>x.path===path)||routes.find(x=>x.path.includes('[id]')&&new RegExp('^'+x.path.replace('[id]','[^/]+')+'$').test(path));const Page=route?.Component;return <ApplicationFrame><div role="status" style={{padding:"10px 16px",background:"#fff4d6",color:"#493a15",fontSize:14}}>CRM und Login sind verfügbar. Automatischer E-Mail-Versand und Videos sind pausiert.</div><Suspense fallback={<p>Seite wird geladen …</p>}>{Page?<Page/>:<main><h1>Seite nicht gefunden</h1><button onClick={()=>navigate('/crm/commercial')}>CRM öffnen</button></main>}</Suspense></ApplicationFrame>}
createRoot(document.getElementById('root')!).render(<App/>);

