import { useMemo, useState } from "react";
import {
  AlertCircle, CheckCircle2, Download, Eye, FileCheck2, FileClock,
  Loader2, MoreVertical, RefreshCw, ShieldOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import type { useFtPayrollStatements } from "@/hooks/useFtPayrollStatements";
import {
  FT_STATEMENT_STATUS_LABELS,
  type FtPayrollStatementStatus,
} from "@/lib/payrollStatementUi";

type Controller = ReturnType<typeof useFtPayrollStatements>;
type StatementActionKey = "draft" | "finalize" | "final-preview" | "pdf" | "refresh";
type StatementAction = { key: StatementActionKey; label: string; icon: LucideIcon; disabled: boolean };

const STATUS_STYLE: Record<FtPayrollStatementStatus, string> = {
  DRAFT: "border-border text-muted-foreground",
  FINALIZING: "border-warning/60 text-warning",
  FINALIZED: "border-success/60 text-success",
  PDF_GENERATING: "border-sky-500/60 text-sky-400",
  PDF_READY: "border-success bg-success/10 text-success",
  PDF_FAILED: "border-destructive/60 text-destructive",
  UNKNOWN: "border-warning/60 bg-warning/10 text-warning",
};

export function FtPayrollStatementSummary(props: {
  controller: Controller;
  totalDealers: number;
}) {
  const { controller, totalDealers } = props;
  if (controller.availability === "legacy") return null;
  if (controller.availability === "blocked") {
    return (
      <div className="flex min-h-12 items-center gap-2 border-y border-border/70 px-1 py-2 text-xs text-muted-foreground">
        <ShieldOff className="h-4 w-4" aria-hidden="true" />
        Phiếu lương bất biến đang tắt cho CLB này.
      </div>
    );
  }
  if (controller.availability === "unknown") {
    return (
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-y border-warning/40 px-1 py-2 text-xs text-warning">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <span className="flex-1">{controller.error}</span>
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void controller.refresh()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Tải lại trạng thái
        </Button>
      </div>
    );
  }
  if (controller.availability === "loading") {
    return (
      <div className="flex min-h-12 items-center gap-2 border-y border-border/70 px-1 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Đang đối chiếu trạng thái phiếu lương...
      </div>
    );
  }
  const items = [
    { label: "Chưa chốt", value: controller.counts.draft, icon: FileClock },
    { label: "Đã chốt", value: controller.counts.finalized, icon: FileCheck2 },
    { label: "Đang tạo PDF", value: controller.counts.generating, icon: Loader2 },
    { label: "PDF sẵn sàng", value: controller.counts.ready, icon: CheckCircle2 },
  ];
  return (
    <div className="grid min-h-14 grid-cols-2 gap-px border-y border-border/70 bg-border/70 sm:grid-cols-4">
      {items.map(({ label, value, icon: Icon }) => (
        <div key={label} className="flex min-w-0 items-center gap-2 bg-background px-3 py-2">
          <Icon className={`h-4 w-4 shrink-0 ${label === "Đang tạo PDF" && value > 0 ? "animate-spin" : ""}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[10px] text-muted-foreground">{label}</div>
            <div className="text-sm font-semibold tabular-nums">{label === "Chưa chốt" ? `${value}/${totalDealers}` : value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FtPayrollStatementBadge(props: { controller: Controller; dealerId: string }) {
  if (props.controller.availability === "legacy" || props.controller.availability === "blocked") return null;
  if (props.controller.availability === "loading") return null;
  const status = props.controller.statusFor(props.dealerId);
  return (
    <Badge variant="outline" className={`h-5 px-1.5 text-[9px] ${STATUS_STYLE[status]}`}>
      {status === "FINALIZING" || status === "PDF_GENERATING" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
      {FT_STATEMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function FtPayrollStatementActions(props: {
  controller: Controller;
  dealerId: string;
  dealerName: string;
  clubName: string;
  periodLabel: string;
}) {
  const { controller, dealerId, dealerName, clubName, periodLabel } = props;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = controller.statusFor(dealerId);
  const isFinal = ["FINALIZED", "PDF_GENERATING", "PDF_READY", "PDF_FAILED"].includes(status);
  const locked = controller.availability !== "ready" || busy || status === "FINALIZING" || status === "PDF_GENERATING";

  const run = async (action: "draft" | "final-preview" | "pdf" | "refresh") => {
    setBusy(true);
    setSheetOpen(false);
    try {
      if (action === "draft") await controller.previewDraft(dealerId);
      if (action === "final-preview") await controller.previewFinal(dealerId);
      if (action === "pdf") await controller.generatePdf(dealerId);
      if (action === "refresh") await controller.refresh();
    } catch {
      toast.error("Không hoàn tất được thao tác phiếu lương. Trạng thái đã được đối chiếu lại.");
    } finally {
      setBusy(false);
    }
  };

  const actions = useMemo<StatementAction[]>(() => {
    if (controller.availability === "unknown" || status === "UNKNOWN") {
      return [{ key: "refresh" as const, label: "Tải lại trạng thái", icon: RefreshCw, disabled: false }];
    }
    const list: StatementAction[] = [
      { key: "draft", label: "Xem bản nháp", icon: Eye, disabled: locked },
    ];
    if (status === "DRAFT") {
      list.push({ key: "finalize" as const, label: "Chốt phiếu", icon: FileCheck2, disabled: locked || !controller.canFinalize });
    }
    if (isFinal) {
      list.push({ key: "final-preview" as const, label: "Xem phiếu", icon: Eye, disabled: locked });
      list.push({ key: "pdf" as const, label: status === "PDF_READY" ? "Tải PDF" : "Tạo & tải PDF", icon: Download, disabled: locked });
    }
    list.push({ key: "refresh" as const, label: "Tải lại trạng thái", icon: RefreshCw, disabled: busy });
    return list;
  }, [busy, controller.availability, controller.canFinalize, isFinal, locked, status]);

  if (controller.availability === "legacy") return null;
  if (controller.availability === "blocked") {
    return <ShieldOff className="h-4 w-4 text-muted-foreground" aria-label="Phiếu lương đang tắt" />;
  }

  const choose = (key: (typeof actions)[number]["key"]) => {
    if (key === "finalize") {
      setSheetOpen(false);
      setConfirmOpen(true);
      return;
    }
    void run(key);
  };

  return (
    <>
      <div className="hidden md:block">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={locked} aria-label={`Hành động phiếu lương ${dealerName}`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {actions.map((action, index) => (
              <div key={action.key}>
                {index === actions.length - 1 && actions.length > 1 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem disabled={action.disabled} onSelect={() => choose(action.key)}>
                  <action.icon className="mr-2 h-4 w-4" /> {action.label}
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button type="button" size="icon" variant="ghost" className="h-10 w-10" disabled={locked} aria-label={`Hành động phiếu lương ${dealerName}`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-5 w-5" />}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-lg pb-8">
            <SheetHeader className="pr-12 text-left">
              <SheetTitle className="text-base">{dealerName}</SheetTitle>
              <SheetDescription>{clubName} · {periodLabel}</SheetDescription>
            </SheetHeader>
            <div className="mt-5 grid gap-2">
              {actions.map((action) => (
                <Button key={action.key} type="button" variant="outline" className="h-11 justify-start" disabled={action.disabled} onClick={() => choose(action.key)}>
                  <action.icon className="mr-2 h-4 w-4" /> {action.label}
                </Button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Chốt phiếu lương FT?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                <div className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-1 text-sm">
                  <span>CLB</span><strong className="text-foreground">{clubName}</strong>
                  <span>Dealer</span><strong className="text-foreground">{dealerName}</strong>
                  <span>Kỳ lương</span><strong className="text-foreground">{periodLabel}</strong>
                </div>
                <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-warning">
                  Sau khi chốt, phiếu trở thành bản ghi bất biến và không thể chỉnh sửa trực tiếp.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Quay lại</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                setBusy(true);
                void controller.finalize(dealerId).then((ok) => {
                  if (ok) toast.success("Đã chốt phiếu lương bất biến");
                  else toast.error("Chưa xác nhận được kết quả. Hệ thống đã khóa thao tác để đối chiếu.");
                }).finally(() => setBusy(false));
              }}
            >
              <FileCheck2 className="mr-2 h-4 w-4" /> Chốt phiếu
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
