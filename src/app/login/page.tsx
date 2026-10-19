import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { getRequestSession } from "@/lib/session";

async function LoginGate() {
  const session = await getRequestSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-900">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">RiskLens</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Sign in
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Transaction surveillance for authorized investigators.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-600">
          <p role="status">Checking session…</p>
        </main>
      }
    >
      <LoginGate />
    </Suspense>
  );
}
