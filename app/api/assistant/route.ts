import { handleAssistantRequest } from "@/lib/assistant-engine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleAssistantRequest(request);
}
