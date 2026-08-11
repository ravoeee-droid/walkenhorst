import { VideoLanding } from "@/components/video-landing";

export default async function VideoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <VideoLanding slug={slug} />;
}
