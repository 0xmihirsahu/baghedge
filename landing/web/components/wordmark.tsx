"use client";

import { Field } from "@/components/field";
import type { Source } from "@/lib/field";

const WORD: Source[] = [{ kind: "text", text: "baghedge" }];
const PITCH: [number, number] = [4, 8];

// the name in dim dots across the bottom. it decodes in once, when half of it is on screen, and under the cursor
export function Wordmark() {
  return (
    <div className="aspect-[4.2/1] w-full">
      <Field sources={WORD} pitch={PITCH} intro introAt={0.5} hover dim />
    </div>
  );
}
