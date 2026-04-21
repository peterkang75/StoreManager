import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MobileLayout } from "@/components/layouts/MobileLayout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Wallet,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Store } from "@shared/schema";

const A = {
  font: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, 'Helvetica Neue', sans-serif",
  shadow: "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px",
};

const NOTE_DENOMS = [
  { key: "note100Count", label: "$100", value: 100 },
  { key: "note50Count",  label: "$50",  value: 50 },
  { key: "note20Count",  label: "$20",  value: 20 },
  { key: "note10Count",  label: "$10",  value: 10 },
  { key: "note5Count",   label: "$5",   value: 5 },
] as const;

type NoteDenomKey = typeof NOTE_DENOMS[number]["key"];
type NoteCounts = Record<NoteDenomKey, number>;

interface PortalSession {
  id: string;
  nickname: string | null;
  firstName: string;
  storeId: string | null;
  storeIds: string[];
  role: string | null;
}

function loadPortalSession(): PortalSession | null {
  try {
    const raw = sessionStorage.getItem("ep_session_v4");
    if (!raw) return null;
    const s = JSON.parse(raw);
    return { id: s.id, nickname: s.nickname ?? null, firstName: s.firstName ?? "", storeId: s.storeId ?? null, storeIds: s.storeIds ?? [], role: s.role ?? null };
  } catch { return null; }
}

function emptyNotes(): NoteCounts {
  return { note100Count: 0, note50Count: 0, note20Count: 0, note10Count: 0, note5Count: 0 };
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#ffffff", borderRadius: 20, padding: "16px 20px", boxShadow: A.shadow }}>
      {title && (
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6a6a6a", marginBottom: 16 }}>{title}</p>
      )}
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 500, color: "#222222", marginBottom: 6 }}>{children}</p>
  );
}

function LockedField({ value }: { value: string }) {
  return (
    <div style={{ height: 44, display: "flex", alignItems: "center", padding: "0 12px", borderRadius: 8, border: "1px solid #c1c1c1", background: "#f2f2f2", fontSize: 15, color: "#222222" }}>
      {value}
    </div>
  );
}

export function MobileDailyClose() {
  const { toast } = useToast();
  const portalSession = useMemo(() => loadPortalSession(), []);
  const displayName = portalSession?.nickname || portalSession?.firstName || "—";

  const [storeId, setStoreId] = useState<string>("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    previousFloat: 0,
    salesTotal: 0,
    cashSales: 0,
    cashOutTotal: 0,
    numberOfReceipts: 0,
    nextFloat: 0,
    ubereatsAmount: 0,
    doordashAmount: 0,
    notes: "",
  });

  const [notes, setNotes] = useState<NoteCounts>(emptyNotes);

  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  // Determine assigned stores from portal session
  const assignedIds: string[] = portalSession?.storeIds ?? (portalSession?.storeId ? [portalSession.storeId] : []);
  const assignedStores: Store[] = useMemo(() => {
    if (!stores) return [];
    if (assignedIds.length > 0) return stores.filter(s => assignedIds.includes(s.id));
    return stores.filter(s => s.active && !s.isExternal);
  }, [stores, assignedIds]);

  // Auto-select if only one store assigned
  useEffect(() => {
    if (assignedStores.length === 1 && !storeId) {
      setStoreId(assignedStores[0].id);
    }
  }, [assignedStores, storeId]);

  const totalCounted = useMemo(() => {
    let sum = 0;
    for (const d of NOTE_DENOMS) sum += (notes[d.key] || 0) * d.value;
    return Math.round(sum * 100) / 100;
  }, [notes]);

  const expectedCredit = form.previousFloat + form.cashSales - form.cashOutTotal - form.nextFloat;
  const differenceAmount = expectedCredit - totalCounted;

  const updateNote = (key: NoteDenomKey, val: string) => {
    setNotes(prev => ({ ...prev, [key]: parseInt(val) || 0 }));
  };

  const updateForm = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: parseFloat(value) || 0 }));
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const closingData = {
        storeId, date,
        previousFloat: form.previousFloat,
        salesTotal: form.salesTotal,
        cashSales: form.cashSales,
        cashOut: form.cashOutTotal,
        nextFloat: form.nextFloat,
        actualCashCounted: totalCounted,
        differenceAmount,
        creditAmount: expectedCredit,
        ubereatsAmount: form.ubereatsAmount,
        doordashAmount: form.doordashAmount,
        notes: form.notes || null,
      };
      const closeFormData = {
        storeId, date,
        submitterName: displayName,
        envelopeAmount: expectedCredit,
        totalCalculated: totalCounted,
        numberOfReceipts: form.numberOfReceipts,
        notes: form.notes || null,
        ...notes,
        coin2Count: 0, coin1Count: 0, coin050Count: 0, coin020Count: 0, coin010Count: 0, coin005Count: 0,
      };
      await apiRequest("POST", "/api/daily-closings", closingData);
      await apiRequest("POST", "/api/daily-close-forms", closeFormData);
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-closings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-close-forms"] });
      setSubmitted(true);
      toast({ title: "Daily close submitted successfully!" });
    },
    onError: () => {
      toast({ title: "Failed to submit daily close", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSubmitted(false);
    setForm({ previousFloat: 0, salesTotal: 0, cashSales: 0, cashOutTotal: 0, numberOfReceipts: 0, nextFloat: 0, ubereatsAmount: 0, doordashAmount: 0, notes: "" });
    setNotes(emptyNotes());
    if (assignedStores.length !== 1) setStoreId("");
  };

  if (storesLoading) {
    return (
      <MobileLayout title="Daily Close">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[0, 1].map(i => (
            <div key={i} style={{ height: 80, background: "#f2f2f2", borderRadius: 20 }} className="animate-pulse" />
          ))}
        </div>
      </MobileLayout>
    );
  }

  if (submitted) {
    return (
      <MobileLayout title="Daily Close">
        <div style={{ background: "#ffffff", borderRadius: 20, padding: 32, textAlign: "center", boxShadow: A.shadow }}>
          <CheckCircle2 style={{ width: 64, height: 64, color: "#222222", margin: "0 auto 16px" }} />
          <h2 style={{ fontSize: 24, fontWeight: 700, color: "#222222", letterSpacing: "-0.44px", marginBottom: 8 }} data-testid="text-success-title">Submitted!</h2>
          <p style={{ fontSize: 14, color: "#6a6a6a", marginBottom: 24 }}>Daily close has been successfully recorded.</p>
          <button
            type="button"
            onClick={resetForm}
            style={{ width: "100%", height: 48, background: "#222222", color: "#ffffff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 500, cursor: "pointer", fontFamily: A.font }}
            data-testid="button-new-close"
          >
            Submit Another
          </button>
        </div>
      </MobileLayout>
    );
  }

  const isSingleStore = assignedStores.length === 1;
  const isMultiStore = assignedStores.length >= 2;
  const canSubmit = !!storeId && !!date && !submitMutation.isPending;

  return (
    <MobileLayout title="Daily Close">
      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 96, fontFamily: A.font }}>

        {/* Session banner — name only, no sign out */}
        <div>
          <p style={{ fontSize: 15, fontWeight: 600, color: "#222222" }}>{displayName}</p>
          <p style={{ fontSize: 12, color: "#6a6a6a", marginTop: 1, textTransform: "capitalize" }}>{(portalSession?.role ?? "").toLowerCase()}</p>
        </div>

        {/* Store & Date */}
        <SectionCard>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Store */}
            <div>
              <FieldLabel>Store</FieldLabel>
              {isSingleStore && (
                <LockedField value={assignedStores[0].name} />
              )}
              {isMultiStore && (
                <div style={{ display: "flex", gap: 8 }}>
                  {assignedStores.map(store => {
                    const active = storeId === store.id;
                    return (
                      <button
                        key={store.id}
                        type="button"
                        onClick={() => setStoreId(store.id)}
                        style={{
                          flex: 1, height: 44, borderRadius: 8, border: "none", cursor: "pointer",
                          background: active ? "#222222" : "#f2f2f2",
                          color: active ? "#ffffff" : "#6a6a6a",
                          fontSize: 15, fontWeight: active ? 600 : 500,
                          transition: "background 160ms, color 160ms",
                          fontFamily: A.font,
                        }}
                        data-testid={`button-store-${store.id}`}
                      >
                        {store.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {!isSingleStore && !isMultiStore && (
                <LockedField value="No store assigned" />
              )}
            </div>

            {/* Date */}
            <div style={{ width: "100%", minWidth: 0 }}>
              <FieldLabel>Date</FieldLabel>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="input-date"
                style={{
                  display: "block",
                  width: "100%",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                  height: 44,
                  padding: "0 12px",
                  fontSize: 15,
                  lineHeight: "44px",
                  border: "1px solid #c1c1c1",
                  borderRadius: 8,
                  background: "#ffffff",
                  color: "#222222",
                  fontFamily: A.font,
                  WebkitAppearance: "none",
                  appearance: "none",
                }}
              />
            </div>

            {/* Submitted By */}
            <div>
              <FieldLabel>Submitted By</FieldLabel>
              <LockedField value={displayName} />
            </div>
          </div>
        </SectionCard>

        {/* Sales & Float */}
        <SectionCard title="Sales & Float">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <FieldLabel>Previous Float</FieldLabel>
              <Input id="previousFloat" type="text" inputMode="decimal" value={form.previousFloat || ""} onChange={(e) => updateForm("previousFloat", e.target.value)} className="h-12 text-base" data-testid="input-previousFloat" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <FieldLabel>Sales Total</FieldLabel>
                <Input id="salesTotal" type="text" inputMode="decimal" value={form.salesTotal || ""} onChange={(e) => updateForm("salesTotal", e.target.value)} className="h-12 text-base" data-testid="input-salesTotal" />
              </div>
              <div>
                <FieldLabel>Cash Sales</FieldLabel>
                <Input id="cashSales" type="text" inputMode="decimal" value={form.cashSales || ""} onChange={(e) => updateForm("cashSales", e.target.value)} className="h-12 text-base" data-testid="input-cashSales" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <FieldLabel>Cash Out Total</FieldLabel>
                <Input id="cashOutTotal" type="text" inputMode="decimal" value={form.cashOutTotal || ""} onChange={(e) => updateForm("cashOutTotal", e.target.value)} className="h-12 text-base" data-testid="input-cashOutTotal" />
              </div>
              <div>
                <FieldLabel>No. of Receipts</FieldLabel>
                <Input id="numberOfReceipts" type="text" inputMode="numeric" value={form.numberOfReceipts || ""} onChange={(e) => setForm(prev => ({ ...prev, numberOfReceipts: parseInt(e.target.value) || 0 }))} className="h-12 text-base" data-testid="input-numberOfReceipts" />
              </div>
            </div>
            <div>
              <FieldLabel>Next Float</FieldLabel>
              <Input id="nextFloat" type="text" inputMode="decimal" value={form.nextFloat || ""} onChange={(e) => updateForm("nextFloat", e.target.value)} className="h-12 text-base" data-testid="input-nextFloat" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <FieldLabel>UberEats</FieldLabel>
                <Input id="ubereats" type="text" inputMode="decimal" value={form.ubereatsAmount || ""} onChange={(e) => updateForm("ubereatsAmount", e.target.value)} className="h-12 text-base" data-testid="input-ubereats" />
              </div>
              <div>
                <FieldLabel>DoorDash</FieldLabel>
                <Input id="doordash" type="text" inputMode="decimal" value={form.doordashAmount || ""} onChange={(e) => updateForm("doordashAmount", e.target.value)} className="h-12 text-base" data-testid="input-doordash" />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Note Count */}
        <SectionCard title="Note Count — Credit Amount">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {NOTE_DENOMS.map(d => (
              <div key={d.key} style={{ textAlign: "center" }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#222222", marginBottom: 6 }}>{d.label}</p>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={notes[d.key] || ""}
                  onChange={(e) => updateNote(d.key, e.target.value)}
                  className="h-14 text-center text-lg font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  data-testid={`input-${d.key}`}
                />
                {notes[d.key] > 0 && (
                  <p style={{ fontSize: 10, color: "#6a6a6a", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                    ${(notes[d.key] * d.value).toFixed(0)}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, padding: "12px 16px", background: "#f2f2f2", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, color: "#6a6a6a" }}>Counted Total</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: "#222222", letterSpacing: "-0.44px" }} data-testid="text-counted-total">${totalCounted.toFixed(2)}</span>
          </div>
        </SectionCard>

        {/* Reconciliation */}
        <SectionCard title="Reconciliation">
          <div style={{ background: "#f2f2f2", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#222222" }}>Expected Credit</span>
                <span style={{ fontSize: 22, fontWeight: 700, color: "#222222", letterSpacing: "-0.44px" }} data-testid="text-expected-credit">${expectedCredit.toFixed(2)}</span>
              </div>
              <p style={{ fontSize: 11, color: "#6a6a6a" }}>Prev Float + Cash Sales − Cash Out − Next Float</p>
              <p style={{ fontSize: 11, color: "#6a6a6a", fontFamily: "monospace", marginTop: 2 }}>
                ${form.previousFloat.toFixed(2)} + ${form.cashSales.toFixed(2)} − ${form.cashOutTotal.toFixed(2)} − ${form.nextFloat.toFixed(2)}
              </p>
            </div>
            <div style={{ borderTop: "1px solid #c1c1c1", paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#222222" }}>Difference</span>
                <span
                  style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.44px", color: differenceAmount > 0.005 ? "#ef4444" : differenceAmount < -0.005 ? "#222222" : "#6a6a6a" }}
                  data-testid="text-difference"
                >
                  {differenceAmount > 0.005 ? `-$${differenceAmount.toFixed(2)}` : differenceAmount < -0.005 ? `+$${Math.abs(differenceAmount).toFixed(2)}` : `$${differenceAmount.toFixed(2)}`}
                  {differenceAmount > 0.005 && <span style={{ fontSize: 11, marginLeft: 4 }}>(Shortage)</span>}
                  {differenceAmount < -0.005 && <span style={{ fontSize: 11, marginLeft: 4 }}>(Overage)</span>}
                </span>
              </div>
              <p style={{ fontSize: 11, color: "#6a6a6a" }}>Expected Credit − Counted Total</p>
              {differenceAmount > 0.005 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, color: "#ef4444", fontSize: 13 }}>
                  <AlertTriangle style={{ width: 14, height: 14 }} />
                  <span>Cash shortage detected</span>
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* Notes */}
        <SectionCard>
          {/* Envelope instruction */}
          <div style={{ background: "#f2f2f2", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: "#6a6a6a", lineHeight: 1.5 }}>
              On the envelope, write only the date — nothing else is needed.
            </p>
          </div>
          <FieldLabel>Notes</FieldLabel>
          <Textarea
            id="notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Any additional notes..."
            className="text-base"
            data-testid="input-notes"
          />
        </SectionCard>
      </div>

      {/* Fixed submit bar */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, padding: 16,
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: "1px solid #c1c1c1",
        paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
      }}>
        <button
          type="button"
          onClick={() => submitMutation.mutate()}
          disabled={!canSubmit}
          style={{
            width: "100%", height: 56, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            background: canSubmit ? "#222222" : "#f2f2f2",
            color: canSubmit ? "#ffffff" : "#6a6a6a",
            border: "none", borderRadius: 8, fontSize: 16, fontWeight: 500,
            cursor: canSubmit ? "pointer" : "default",
            fontFamily: A.font, transition: "background 160ms, color 160ms",
          }}
          data-testid="button-submit"
        >
          {submitMutation.isPending
            ? <Loader2 style={{ width: 20, height: 20 }} className="animate-spin" />
            : <Wallet style={{ width: 20, height: 20 }} />}
          Submit Daily Close
        </button>
      </div>
    </MobileLayout>
  );
}
