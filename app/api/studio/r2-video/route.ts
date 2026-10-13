import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!/^renders\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|webm)$/i.test(key)) return NextResponse.json({error:"Invalid video key"},{status:400});
  const endpoint=process.env.R2_ENDPOINT, accessKeyId=process.env.R2_ACCESS_KEY_ID, secretAccessKey=process.env.R2_SECRET_ACCESS_KEY;
  if(!endpoint||!accessKeyId||!secretAccessKey) return NextResponse.json({error:"Storage unavailable"},{status:503});
  const s3=new S3Client({region:"auto",endpoint,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey}});
  const url=await getSignedUrl(s3,new GetObjectCommand({Bucket:process.env.R2_BUCKET||"walkenhorst",Key:key}),{expiresIn:900});
  return NextResponse.redirect(url,302);
}
