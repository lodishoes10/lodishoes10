import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  children,
  testId,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4" data-testid={testId}>
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  testId,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/60 px-6 py-12 text-center",
        className,
      )}
      data-testid={testId}
    >
      {Icon && <Icon className="size-8 text-muted-foreground/60" />}
      <p className="font-heading text-base font-semibold">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function SkeletonRows({ rows = 4, testId }: { rows?: number; testId?: string }) {
  return (
    <div className="space-y-2" data-testid={testId}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-lg bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%]"
        />
      ))}
    </div>
  );
}

/** Banner non-blocking: dipakai saat fetch gagal supaya halaman tetap tampil utuh. */
export function ErrorNote({ message, testId }: { message: string; testId?: string }) {
  return (
    <div
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      data-testid={testId}
    >
      {message}
    </div>
  );
}
