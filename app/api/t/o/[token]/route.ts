import { NextRequest } from "next/server";
import { postPublicEmailEvent } from "@/lib/email-public-event";

const PIXEL = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));

export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  await postPublicEmailEvent({ token, event: "open", userAgent: req.headers.get("user-agent") }, 1200);
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "content-length": String(PIXEL.byteLength),
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      pragma: "no-cache",
      expires: "0",
      "x-content-type-options": "nosniff",
    },
  });
}
