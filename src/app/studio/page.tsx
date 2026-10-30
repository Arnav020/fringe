import { Suspense } from "react";
import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Studio from "@/components/Studio";

export const metadata: Metadata = {
  title: "Studio · Fringe",
  description: "Build a personal AAC board from what someone loves, grounded in Qloo's taste graph.",
};

export default function StudioPage() {
  return (
    <main className="flex-1">
      <Nav />
      <Suspense fallback={<div className="p-10 text-center text-muted">Loading the studio…</div>}>
        <Studio />
      </Suspense>
    </main>
  );
}
