import { createBrowserClient } from "@supabase/ssr";
import { Upload } from "tus-js-client";

const RESUMABLE_THRESHOLD=6*1024*1024;
const TUS_CHUNK_SIZE=6*1024*1024;
export const ENERGY_MEDIA_UPLOAD_EVENT="energy-media-upload-progress";

export type EnergyMediaUploadProgress={
  path:string;
  fileName:string;
  uploaded:number;
  total:number;
  percent:number;
  state:"uploading"|"complete"|"error";
};

function projectRefFromUrl(url:string){try{return new URL(url).hostname.split(".")[0]||""}catch{return""}}
function emitUpload(detail:EnergyMediaUploadProgress){if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent<EnergyMediaUploadProgress>(ENERGY_MEDIA_UPLOAD_EVENT,{detail}))}

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
      const isFile=typeof File!=="undefined"&&fileBody instanceof File;
      const fileName=isFile?fileBody.name:path.split("/").at(-1)||"Medium";
      const total=isFile?fileBody.size:Number(fileBody?.size||0);
      emitUpload({path,fileName,uploaded:0,total,percent:0,state:"uploading"});
      if(!isFile||fileBody.size<=RESUMABLE_THRESHOLD){
        const result=await standardUpload(path,fileBody,options);
        emitUpload({path,fileName,uploaded:result.error?0:total,total,percent:result.error?0:100,state:result.error?"error":"complete"});
        return result;
      }
      const{data:{session},error:sessionError}=await client.auth.getSession();
      if(sessionError||!session?.access_token){const error=sessionError||new Error("Für den resumierbaren Upload ist eine aktive Session erforderlich.");emitUpload({path,fileName,uploaded:0,total,percent:0,state:"error"});return{data:null,error}}
      const projectRef=projectRefFromUrl(url);
      if(!projectRef){emitUpload({path,fileName,uploaded:0,total,percent:0,state:"error"});return{data:null,error:new Error("Supabase-Projekt-ID konnte nicht ermittelt werden.")}}
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
            onProgress:(uploaded,totalBytes)=>emitUpload({path,fileName,uploaded,total:totalBytes,percent:totalBytes?Math.min(100,Math.round(uploaded/totalBytes*100)):0,state:"uploading"}),
            onError:error=>reject(error),
            onSuccess:()=>resolve(),
          });
          void upload.findPreviousUploads().then(previous=>{if(previous.length)upload.resumeFromPreviousUpload(previous[0]);upload.start()}).catch(reject);
        });
        emitUpload({path,fileName,uploaded:total,total,percent:100,state:"complete"});
        return{data:{path,id:"",fullPath:`${bucketId}/${path}`},error:null};
      }catch(error){emitUpload({path,fileName,uploaded:0,total,percent:0,state:"error"});return{data:null,error:error instanceof Error?error:new Error("Resumierbarer Upload fehlgeschlagen.")}}
    };
    return bucket;
  };
  return client;
}
