import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Supplier, Store } from "@shared/schema";
import { Upload, FileText, ImageIcon, Loader2, CheckCircle2, AlertCircle, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

const formSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  storeId: z.string().min(1, "Store is required"),
  invoiceNumber: z.string().min(1, "Invoice number is required"),
  invoiceDate: z.string().min(1, "Invoice date is required"),
  dueDate: z.string().optional(),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, "Must be a positive number"),
});

type FormValues = z.infer<typeof formSchema>;

type ScanState = "idle" | "uploading" | "success" | "error";

interface ParsedItem {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  amount: number;
  storeCode: string;
}

interface ScanResponse {
  items: ParsedItem[];
  matchedSupplierId: string | null;
  isStatement: boolean;
}

function fmtAUD(n: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);
}

export default function AddInvoiceModal({ open, onClose }: Props) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"scan" | "manual">("scan");
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedFileName, setScannedFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Statement mode — multiple items returned
  const [statementItems, setStatementItems] = useState<ParsedItem[] | null>(null);
  const [statementSupplierId, setStatementSupplierId] = useState<string>("");
  const [statementStoreId, setStatementStoreId] = useState<string>("");
  const [isCreatingAll, setIsCreatingAll] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState<string>("");

  const CREATE_NEW = "__new__";

  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/stores"] });

  const activeStores = stores.filter((s) => s.active);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      supplierId: "",
      storeId: "",
      invoiceNumber: "",
      invoiceDate: "",
      dueDate: "",
      amount: "",
    },
  });

  const resolveStoreId = useCallback(
    (storeCode: string): string => {
      if (storeCode && storeCode !== "UNKNOWN") {
        const keyword = storeCode.toLowerCase();
        const matched = activeStores.find((s) => s.name.toLowerCase().includes(keyword));
        if (matched) return matched.id;
      }
      return "";
    },
    [activeStores]
  );

  const prefillFromScan = useCallback(
    (item: ParsedItem, matchedSupplierId: string | null) => {
      form.setValue("supplierId", matchedSupplierId ?? "");
      form.setValue("invoiceNumber", item.invoiceNumber || "");
      form.setValue("invoiceDate", item.invoiceDate || "");
      form.setValue("dueDate", item.dueDate || "");
      form.setValue("amount", item.amount ? String(item.amount) : "");
      const storeId = resolveStoreId(item.storeCode);
      if (storeId) form.setValue("storeId", storeId, { shouldValidate: true });
    },
    [form, resolveStoreId]
  );

  const uploadAndParse = useCallback(
    async (file: File) => {
      setScanState("uploading");
      setScanError(null);
      setScannedFileName(file.name);
      setStatementItems(null);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/invoices/parse-upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(err.error ?? "Upload failed");
        }

        const response: ScanResponse = await res.json();

        if (response.isStatement && response.items.length > 1) {
          // Statement mode — show multi-item UI
          setStatementItems(response.items);
          setStatementSupplierId(response.matchedSupplierId ?? "");
          // Pre-select store from the first item
          const firstStoreId = resolveStoreId(response.items[0]?.storeCode ?? "");
          setStatementStoreId(firstStoreId);
          setScanState("success");
        } else {
          // Single invoice — pre-fill form as before
          const item = response.items[0];
          if (item) prefillFromScan(item, response.matchedSupplierId);
          setScanState("success");
          setTimeout(() => setActiveTab("manual"), 700);
        }
      } catch (err: unknown) {
        setScanState("error");
        setScanError(err instanceof Error ? err.message : "Failed to parse invoice");
      }
    },
    [prefillFromScan, resolveStoreId]
  );

  const handleFileSelected = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
      if (!allowed.includes(file.type)) {
        setScanState("error");
        setScanError("Only JPEG, PNG, WebP images and PDFs are supported.");
        return;
      }
      uploadAndParse(file);
    },
    [uploadAndParse]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      handleFileSelected(file);
    },
    [handleFileSelected]
  );

  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const body = {
        supplierId: values.supplierId,
        storeId: values.storeId,
        invoiceNumber: values.invoiceNumber,
        invoiceDate: values.invoiceDate,
        dueDate: values.dueDate || null,
        amount: parseFloat(values.amount),
        status: "PENDING",
      };
      return apiRequest("POST", "/api/invoices", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice added", description: "New invoice saved as pending." });
      handleClose();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save invoice", description: err.message, variant: "destructive" });
    },
  });

  const handleCreateAll = useCallback(async () => {
    if (!statementItems || !statementSupplierId || !statementStoreId) {
      toast({ title: "Supplier and Store required", description: "Please select a supplier and store before creating invoices.", variant: "destructive" });
      return;
    }
    if (statementSupplierId === CREATE_NEW && !newSupplierName.trim()) {
      toast({ title: "Supplier name required", description: "Enter a name for the new supplier.", variant: "destructive" });
      return;
    }
    setIsCreatingAll(true);

    // If creating a new supplier, do that first
    let resolvedSupplierId = statementSupplierId;
    if (statementSupplierId === CREATE_NEW) {
      try {
        const res = await apiRequest("POST", "/api/suppliers", { name: newSupplierName.trim() });
        const newSupplier: Supplier = await res.json();
        resolvedSupplierId = newSupplier.id;
        queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      } catch (err: any) {
        setIsCreatingAll(false);
        toast({ title: "Failed to create supplier", description: err?.message, variant: "destructive" });
        return;
      }
    }

    let created = 0;
    let skipped = 0;
    const failedNums: string[] = [];
    const today = new Date().toISOString().split("T")[0];

    for (const item of statementItems) {
      try {
        const res = await fetch("/api/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            supplierId: resolvedSupplierId,
            storeId: statementStoreId,
            invoiceNumber: item.invoiceNumber,
            invoiceDate: item.invoiceDate || today,
            dueDate: item.dueDate || null,
            amount: item.amount,
            status: "PENDING",
          }),
        });

        if (res.status === 409) {
          // Duplicate invoice — skip gracefully
          skipped++;
        } else if (!res.ok) {
          failedNums.push(item.invoiceNumber || "?");
        } else {
          created++;
        }
      } catch {
        failedNums.push(item.invoiceNumber || "?");
      }
    }

    setIsCreatingAll(false);
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });

    if (failedNums.length === 0 && skipped === 0) {
      toast({ title: `${created} invoice${created !== 1 ? "s" : ""} created`, description: "All statement line items saved as pending." });
      handleClose();
    } else if (failedNums.length === 0) {
      // Only duplicates — all skipped
      const msg = created > 0
        ? `${created} created, ${skipped} already existed and were skipped.`
        : `All ${skipped} invoice${skipped !== 1 ? "s" : ""} already exist in the system.`;
      toast({ title: "Done", description: msg });
      handleClose();
    } else {
      // Some real failures
      toast({
        title: `${created} created${skipped > 0 ? `, ${skipped} skipped` : ""}, ${failedNums.length} failed`,
        description: `Could not save: ${failedNums.join(", ")}`,
        variant: "destructive",
      });
    }
  }, [statementItems, statementSupplierId, statementStoreId, newSupplierName, toast]);

  const handleClose = () => {
    form.reset();
    setScanState("idle");
    setScanError(null);
    setScannedFileName(null);
    setActiveTab("scan");
    setStatementItems(null);
    setStatementSupplierId("");
    setStatementStoreId("");
    setIsCreatingAll(false);
    setNewSupplierName("");
    onClose();
  };

  const onSubmit = (values: FormValues) => createMutation.mutate(values);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Invoice</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "scan" | "manual")}>
          <TabsList className="w-full mb-4">
            <TabsTrigger value="scan" className="flex-1" data-testid="tab-ai-scan">
              AI Scan
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex-1" data-testid="tab-manual-entry">
              Manual Entry
            </TabsTrigger>
          </TabsList>

          {/* ── AI Scan Tab ── */}
          <TabsContent value="scan" className="mt-0 space-y-4">
            {/* Statement multi-item result */}
            {scanState === "success" && statementItems && statementItems.length > 1 ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <Receipt className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Statement of Account detected</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">{statementItems.length} individual invoices found — select supplier and store to create all.</p>
                  </div>
                </div>

                {/* Supplier selector */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Supplier <span className="text-red-500">*</span></label>
                  <Select value={statementSupplierId} onValueChange={(v) => { setStatementSupplierId(v); if (v !== CREATE_NEW) setNewSupplierName(""); }}>
                    <SelectTrigger data-testid="select-statement-supplier">
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CREATE_NEW} data-testid="option-stmt-supplier-new">
                        + Create new supplier
                      </SelectItem>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id} data-testid={`option-stmt-supplier-${s.id}`}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {statementSupplierId === CREATE_NEW && (
                    <Input
                      data-testid="input-new-supplier-name"
                      placeholder="Supplier name"
                      value={newSupplierName}
                      onChange={(e) => setNewSupplierName(e.target.value)}
                      autoFocus
                    />
                  )}
                </div>

                {/* Store selector */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Store <span className="text-red-500">*</span></label>
                  <Select value={statementStoreId} onValueChange={setStatementStoreId}>
                    <SelectTrigger data-testid="select-statement-store">
                      <SelectValue placeholder="Select store" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeStores.map((s) => (
                        <SelectItem key={s.id} value={s.id} data-testid={`option-stmt-store-${s.id}`}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Line items preview */}
                <div className="rounded-md border border-border overflow-hidden">
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                    <span>Invoice #</span>
                    <span>Date</span>
                    <span className="text-right">Amount</span>
                  </div>
                  <div className="divide-y divide-border max-h-52 overflow-y-auto">
                    {statementItems.map((item, i) => (
                      <div key={i} className="grid grid-cols-3 gap-2 px-3 py-2 text-sm">
                        <span className="font-mono text-xs truncate">{item.invoiceNumber || "—"}</span>
                        <span className="text-muted-foreground text-xs">{item.invoiceDate || "—"}</span>
                        <span className="text-right font-medium tabular-nums">{fmtAUD(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-muted/30 border-t border-border">
                    <span className="text-xs text-muted-foreground col-span-2 font-medium">Total</span>
                    <span className="text-right text-sm font-semibold tabular-nums">
                      {fmtAUD(statementItems.reduce((s, i) => s + i.amount, 0))}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={handleClose} data-testid="button-cancel-statement">
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleCreateAll}
                    disabled={isCreatingAll || !statementSupplierId || !statementStoreId || (statementSupplierId === CREATE_NEW && !newSupplierName.trim())}
                    data-testid="button-create-all-invoices"
                  >
                    {isCreatingAll ? (
                      <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Creating…</>
                    ) : (
                      <>Create {statementItems.length} Invoices</>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div
                  data-testid="invoice-drop-zone"
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-10 transition-colors cursor-pointer",
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/30 hover:border-muted-foreground/60 bg-muted/20"
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => scanState !== "uploading" && fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    data-testid="input-invoice-file"
                    onChange={(e) => handleFileSelected(e.target.files?.[0])}
                  />

                  {scanState === "idle" && (
                    <>
                      <div className="flex gap-2 text-muted-foreground">
                        <ImageIcon className="w-6 h-6" />
                        <FileText className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-medium text-center">
                        Drag &amp; drop or click to upload
                      </p>
                      <p className="text-xs text-muted-foreground text-center">
                        Supports JPEG, PNG, WebP images and PDF files (max 10 MB)
                      </p>
                      <Button size="sm" variant="outline" type="button" data-testid="button-browse-file">
                        <Upload className="w-4 h-4 mr-1.5" />
                        Browse file
                      </Button>
                    </>
                  )}

                  {scanState === "uploading" && (
                    <>
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <p className="text-sm font-medium">Scanning with AI…</p>
                      {scannedFileName && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {scannedFileName}
                        </p>
                      )}
                    </>
                  )}

                  {scanState === "success" && !statementItems && (
                    <>
                      <CheckCircle2 className="w-8 h-8 text-green-600" />
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">
                        Scan complete — switching to form…
                      </p>
                      {scannedFileName && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {scannedFileName}
                        </p>
                      )}
                    </>
                  )}

                  {scanState === "error" && (
                    <>
                      <AlertCircle className="w-8 h-8 text-destructive" />
                      <p className="text-sm font-medium text-destructive">Scan failed</p>
                      {scanError && (
                        <p className="text-xs text-muted-foreground text-center max-w-[260px]">
                          {scanError}
                        </p>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        data-testid="button-retry-scan"
                        onClick={(e) => {
                          e.stopPropagation();
                          setScanState("idle");
                          setScanError(null);
                          setScannedFileName(null);
                        }}
                      >
                        Try again
                      </Button>
                    </>
                  )}
                </div>

                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Or{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                    onClick={() => setActiveTab("manual")}
                    data-testid="link-enter-manually"
                  >
                    enter details manually
                  </button>
                </p>
              </>
            )}
          </TabsContent>

          {/* ── Manual Entry Tab ── */}
          <TabsContent value="manual" className="mt-0">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {/* Supplier */}
                <FormField
                  control={form.control}
                  name="supplierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supplier</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-supplier">
                            <SelectValue placeholder="Select supplier" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id} data-testid={`option-supplier-${s.id}`}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Store */}
                <FormField
                  control={form.control}
                  name="storeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Store</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-store">
                            <SelectValue placeholder="Select store" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {activeStores.map((s) => (
                            <SelectItem key={s.id} value={s.id} data-testid={`option-store-${s.id}`}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Invoice Number */}
                <FormField
                  control={form.control}
                  name="invoiceNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Invoice Number</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. INV-00123"
                          data-testid="input-invoice-number"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Amount */}
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount (AUD)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          data-testid="input-invoice-amount"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Dates row */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="invoiceDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Invoice Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            data-testid="input-invoice-date"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="dueDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Due Date (optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            data-testid="input-invoice-due-date"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClose}
                    data-testid="button-cancel-invoice"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending}
                    data-testid="button-save-invoice"
                  >
                    {createMutation.isPending && (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    )}
                    Save Invoice
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
