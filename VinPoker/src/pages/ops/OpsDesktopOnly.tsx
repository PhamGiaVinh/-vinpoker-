import { MonitorUp } from "lucide-react";

type OpsDesktopOnlyProps = {
  title: string;
  description: string;
};

/** Honest production fallback for operator modules that are not wired on mobile yet. */
export default function OpsDesktopOnly({ title, description }: OpsDesktopOnlyProps) {
  return (
    <div className="ios-in space-y-5 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">{title}</h1>
      </header>
      <section className="ios-card px-5 py-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#c9a86a]/14 text-[#d8bc85]">
          <MonitorUp className="h-6 w-6" />
        </span>
        <h2 className="mt-3 text-[17px] font-semibold text-[#f2ece6]">Dùng trên máy tính</h2>
        <p className="mt-1 text-[14px] leading-5 text-[#9b8e97]">{description}</p>
        <p className="mt-3 text-[12px] text-[#6f646c]">Màn hình này không hiển thị dữ liệu mẫu.</p>
      </section>
    </div>
  );
}
