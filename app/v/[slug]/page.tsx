import { VideoLanding } from "@/components/video-landing";
import { VideoEngagementTracker } from "@/components/video-engagement-tracker";

export default async function VideoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <><VideoEngagementTracker slug={slug}/><VideoLanding slug={slug}/></>;
}
