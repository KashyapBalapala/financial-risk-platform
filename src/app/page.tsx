import { Suspense } from "react";
import { redirect } from "next/navigation";
import { InvestigatorDashboard } from "./components/investigator-dashboard";
import { getRequestSession } from "@/lib/session";

async function ProtectedDashboard() {
  const session = await getRequestSession();
  if (!session) {
    redirect("/login");
  }

  return <InvestigatorDashboard investigatorName={session.user.name} />;
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-600">
          <p role="status">Checking session…</p>
        </main>
      }
    >
      <ProtectedDashboard />
    </Suspense>
  );
}
