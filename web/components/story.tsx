"use client";

import { useScroll, type UseScrollOptions } from "motion/react";
import { useRef } from "react";
import { About } from "@/components/about";
import { Architecture } from "@/components/architecture";
import { Launch } from "@/components/launch";
import { Reel } from "@/components/reel";

const INTO: UseScrollOptions = { offset: ["start end", "start start"] };

// each pinned card shrinks back and darkens while the next one slides over it
export function Story() {
  const arch = useRef<HTMLElement>(null);
  const about = useRef<HTMLElement>(null);
  const launch = useRef<HTMLElement>(null);
  const archIn = useScroll({ target: arch, ...INTO }).scrollYProgress;
  const aboutIn = useScroll({ target: about, ...INTO }).scrollYProgress;
  const launchIn = useScroll({ target: launch, ...INTO }).scrollYProgress;
  return (
    <>
      <Reel recede={archIn} />
      <Architecture sectionRef={arch} recede={aboutIn} />
      <About sectionRef={about} recede={launchIn} />
      <Launch sectionRef={launch} />
    </>
  );
}
