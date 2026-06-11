/**
 * Root → the orchestrator UI. The previous root page (the legacy Brain-1
 * tester) lives on at /legacy.
 */
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/orchestrate");
}
