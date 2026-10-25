import { notFound } from "next/navigation";
import Workspace from "../workspace";
const allowed = new Set([
  "partners",
  "revenues",
  "costs",
  "licenses",
  "legal-parties",
  "model-configs",
  "onboarding-tasks",
  "account-tasks",
  "identity-consents",
  "dashboard",
  "login",
  "influencers",
  "accounts",
  "connectors",
  "contracts",
  "governance",
  "disclosures",
  "assets",
  "media",
  "editorial",
  "studio",
  "approvals",
  "publications",
  "agents",
  "inbox",
  "contacts",
  "consents",
  "templates",
  "campaigns",
  "analytics",
  "settings",
  "security",
  "privacy",
  "terms",
  "about",
]);
export async function generateMetadata({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  return { title: path.join(" / ") };
}
export default async function Page({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  if (!allowed.has(path[0])) notFound();
  return <Workspace key={path.join("/")} path={`/${path.join("/")}`} />;
}
