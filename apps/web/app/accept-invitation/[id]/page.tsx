import AcceptInvitation from "../../invitation-accept";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AcceptInvitation id={id} />;
}
