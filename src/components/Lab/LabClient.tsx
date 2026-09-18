"use client";

import dynamic from "next/dynamic";

const LabApp = dynamic(() => import("./LabApp"), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-[#050607]" />,
});

export default function LabClient() {
  return <LabApp />;
}
