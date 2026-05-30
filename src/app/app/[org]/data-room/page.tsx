import { requireOrg } from "@/lib/auth/session";
import { DataRoomChat } from "@/components/app/data-room-chat";

export default async function DataRoomPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  await requireOrg(slug);
  return <DataRoomChat slug={slug} />;
}
