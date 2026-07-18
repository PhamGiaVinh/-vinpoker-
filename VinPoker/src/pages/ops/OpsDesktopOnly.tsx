import { Monitor } from "lucide-react";

export default function OpsDesktopOnly({ title, description }: { title: string; description: string }) {
  return (
    <div className="ios-in pt-2">
      <section className="ios-card flex flex-col items-center px-6 py-12 text-center">
        <Monitor className="h-9 w-9 text-[#c9a86a]" />
        <h1 className="mt-3 text-xl font-semibold text-[#f2ece6]">{title}</h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-[#9b8e97]">{description}</p>
      </section>
    </div>
  );
}
