import { createBrowserClient } from "@supabase/ssr";
import { Upload } from "tus-js-client";

const RESUMABLE_THRESHOLD=6*1024*1024;
const TUS_CHUNK_SIZE=6*1024*1024;

function projectRefFromUrl(url:string){try{return new URL(url).hostname.split(".")[0]||""}catch{return""}}

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const client=createBrowserClient(url,key);
  const originalFrom=client.storage.from.bind(client.storage);
  (client.storage as any).from=(bucketId:string)=>{
    const bucket=originalFrom(bucketId);
    if(bucketId!=="energy-media")return bucket;
    const standardUpload=bucket.upload.bind(bucket);
    (bucket as any).upload=async(path:string,fileBody:any,options:any={})=>{
      if(typeof File==="undefined"||!(fileBody instanceof File)||fileBody.size<=RESUMABLE_THRESHOLD)return standardUpload(path,fileBody,options);
      const{data:{session},error:sessionError}=await client.auth.getSession();
      if(sessionError||!session?.access_token)return{data:null,error:sessionError||new Error("Für den resumierbaren Upload ist eine aktive Session erforderlich.")};
      const projectRef=projectRefFromUrl(url);
      if(!projectRef)return{data:null,error:new Error("Supabase-Projekt-ID konnte nicht ermittelt werden.")};
      try{
        await new Promise<void>((resolve,reject)=>{
          const upload=new Upload(fileBody,{
            endpoint:`https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`,
            retryDelays:[0,3000,5000,10000,20000],
            headers:{authorization:`Bearer ${session.access_token}`,apikey:key},
            uploadDataDuringCreation:true,
            removeFingerprintOnSuccess:true,
            chunkSize:TUS_CHUNK_SIZE,
            metadata:{bucketName:bucketId,objectName:path,contentType:options?.contentType||fileBody.type||"application/octet-stream",cacheControl:String(options?.cacheControl||"3600")},
            onError:error=>reject(error),
            onSuccess:()=>resolve(),
          });
          void upload.findPreviousUploads().then(previous=>{if(previous.length)upload.resumeFromPreviousUpload(previous[0]);upload.start()}).catch(reject);
        });
        return{data:{path,id:"",fullPath:`${bucketId}/${path}`},error:null};
      }catch(error){return{data:null,error:error instanceof Error?error:new Error("Resumierbarer Upload fehlgeschlagen.")}}
    };
    return bucket;
  };
  return client;
}
