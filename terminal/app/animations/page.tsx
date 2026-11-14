import type { Metadata } from "next";
import { Animations } from "@/components/animations";

export const metadata: Metadata = { title: "Animations" };

export default function Page() {
  return <Animations />;
}
