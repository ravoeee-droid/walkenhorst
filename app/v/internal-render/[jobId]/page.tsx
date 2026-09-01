import { AutomaticRenderJob } from "@/components/automatic-render-job";

export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false,noarchive:true,nosnippet:true}};

export default async function VideoRenderPage({params,searchParams}:{params:Promise<{jobId:string}>;searchParams:Promise<{token?:string}>}){
  const{jobId}=await params;
  const{token=""}=await searchParams;
  if(!jobId||!token)return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#050b12",color:"#fff",fontFamily:"Arial,sans-serif"}}>Render-Zugriff fehlt.</main>;
  return <AutomaticRenderJob jobId={jobId} token={token}/>;
}