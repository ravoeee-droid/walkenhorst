import {createSupabaseBrowserClient as originalClient,ENERGY_MEDIA_UPLOAD_EVENT} from '../../lib/supabase-browser';
export {ENERGY_MEDIA_UPLOAD_EVENT};
export type {EnergyMediaUploadProgress} from '../../lib/supabase-browser';
export function createSupabaseBrowserClient(){
  const client=originalClient();if(!client)return client;
  const originalFrom=client.storage.from.bind(client.storage);
  (client.storage as any).from=(bucketId:string)=>{
    const bucket=originalFrom(bucketId);
    const reject=async(path:string,file?:any)=>{const error=new Error('Medien-Speicherung ist zum Schutz von Login und CRM gesperrt.');window.dispatchEvent(new CustomEvent(ENERGY_MEDIA_UPLOAD_EVENT,{detail:{path,fileName:file?.name||path,uploaded:0,total:file?.size||0,percent:0,state:'error'}}));return{data:null,error}};
    (bucket as any).upload=reject;
    (bucket as any).update=reject;
    (bucket as any).uploadToSignedUrl=reject;
    (bucket as any).createSignedUploadUrl=reject;
    return bucket;
  };
  return client;
}
