import { notFound } from "next/navigation";
import { getQuestion } from "@/lib/queries";
import { Docket } from "@/components/docket";
export const dynamic = "force-dynamic";
export const metadata = { title: "Question docket" };
export default async function DocketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const q = await getQuestion((await params).id);
  if (!q) notFound();
  return <Docket initial={q} />;
}
