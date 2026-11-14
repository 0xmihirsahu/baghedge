"use client";

import { useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function Waitlist() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setState("error");
    setState("sending");
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setState(res?.ok ? "done" : "error");
  }

  if (state === "done") return <p className="text-[17px] text-white/60">You&apos;re on the list. We&apos;ll write when yours is ready.</p>;

  return (
    <form onSubmit={submit} className="w-full max-w-[420px]">
      <div className="flex items-center gap-2 rounded-[14px] bg-white/[0.06] p-1.5 pl-4">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          placeholder="Your email"
          aria-label="Email"
          className="min-w-0 flex-1 bg-transparent text-[16px] text-white placeholder:text-white/35 focus:outline-none"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="rounded-[10px] bg-brand px-4 py-2.5 text-[14px] font-medium text-white transition-transform active:scale-[0.97]"
        >
          {state === "sending" ? "Joining" : "Join"}
        </button>
      </div>
      {state === "error" && <p className="mt-3 text-[14px] text-brand">That email doesn&apos;t look right.</p>}
    </form>
  );
}
