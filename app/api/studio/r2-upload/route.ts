import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";
const MAX_SIZE = 100 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseAnon) return NextResponse.json({ error: "Supabase auth unavailable" }, { status: 503 });
  const supabase = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { fileName, contentType, size } = await req.json();
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SIZE || !["video/mp4", "video/webm"].includes(contentType)) {
    return NextResponse.json({ error: "Invalid render size or type" }, { status: 400 });
  }
  const keyId = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET || "walkenhorst";
  if (!keyId || !secret || !endpoint) return NextResponse.json({ error: "R2 is not configured" }, { status: 503 });
  const ext = contentType === "video/mp4" ? "mp4" : "webm";
  const key = `renders/${user.id}/${crypto.randomUUID()}.${ext}`;
  const s3 = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId: keyId, secretAccessKey: secret }, forcePathStyle: true });
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: size });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
  // This URL must NOT be treated as a public playback URL.
  return NextResponse.json({ uploadUrl, key, bucket });
}
