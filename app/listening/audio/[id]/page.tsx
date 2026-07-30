import { MaterialListeningClient } from "@/components/listening/material-listening-client";

// Next 16: params is a Promise (AGENTS.md — dynamic route breaking change).
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MaterialListeningClient materialId={id} />;
}
