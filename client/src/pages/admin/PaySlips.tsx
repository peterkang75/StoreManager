import { useState, useEffect } from "react";
import { useLocation } from "wouter";

interface SlipEntry {
  storeName: string;
  hours: number;
  grossAmount: number;
  adjustment: number;
  adjustmentReason: string | null;
  cashAmount: number;
  bankDepositAmount: number;
}

interface PaySlip {
  employee: {
    id: string;
    name: string;
    nickname: string | null;
  };
  entries: SlipEntry[];
  grandTotals: {
    hours: number;
    grossAmount: number;
    cashAmount: number;
    bankDepositAmount: number;
    totalWithAdjustment: number;
  };
  periodStart: string;
  periodEnd: string;
}

// A4 is split into three fixed-height slots so the cut lines always fall at the
// same place on the paper, whatever each slip contains.
const SLOTS_PER_SHEET = 3;

function chunkIntoSheets(slips: PaySlip[]): (PaySlip | null)[][] {
  const sheets: (PaySlip | null)[][] = [];
  for (let i = 0; i < slips.length; i += SLOTS_PER_SHEET) {
    const sheet: (PaySlip | null)[] = slips.slice(i, i + SLOTS_PER_SHEET);
    // Pad the last sheet so its cut lines still print in the same positions.
    while (sheet.length < SLOTS_PER_SHEET) sheet.push(null);
    sheets.push(sheet);
  }
  return sheets;
}

// Slips go into cash envelopes handed out on the floor, so stores print as
// short codes rather than by name. Anything outside Sushi/Sandwich keeps its
// own name — better an unmapped label than a wrong one.
function storeCode(storeName: string): string {
  const n = storeName.toLowerCase();
  if (n.includes("sushi")) return "A";
  if (n.includes("sandwich")) return "B";
  return storeName;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function fmtMoney(v: number): string {
  return `$${v.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AdminPaySlips() {
  const [slips, setSlips] = useState<PaySlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const periodStart = params.get("period_start");
    const periodEnd = params.get("period_end");
    const storeId = params.get("store_id");

    if (!periodStart || !periodEnd) {
      setLoading(false);
      return;
    }

    const qs = new URLSearchParams({ period_start: periodStart, period_end: periodEnd });
    if (storeId) qs.set("store_id", storeId);

    fetch(`/api/payrolls/envelope-slips?${qs}`)
      .then((res) => res.json())
      .then((data: PaySlip[]) => {
        // Pay slips are the paper that goes INTO the cash envelope, so only
        // employees who actually receive cash this period need one. Anyone with
        // cashAmount 0 (bank-only, intercompany, etc.) is excluded.
        setSlips(data.filter(s => s.grandTotals.cashAmount > 0));
        setLoading(false);
        setTimeout(() => window.print(), 500);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg">Loading pay slips...</p>
      </div>
    );
  }

  if (slips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-lg">No pay slips found for this period.</p>
        <button
          onClick={() => setLocation("/admin/payrolls")}
          className="text-sm underline"
          data-testid="link-back-payrolls"
        >
          Back to Payrolls
        </button>
      </div>
    );
  }

  const sheets = chunkIntoSheets(slips);

  return (
    <>
      <style>{`
        /* Fixed A4 thirds. Every sheet is the same physical size and every slot
           is the same fixed height, so the cut lines always land at 99mm and
           198mm from the top of the paper regardless of how much content a slip
           has. That is what lets a stack of printed sheets be guillotined in one
           go. Requires printing at 100% scale with no browser margins. */
        @page { size: A4; margin: 0; }

        @media print {
          body { margin: 0; padding: 0; background: #fff; }
          .no-print { display: none !important; }
          .payslip-container { padding: 0; margin: 0; }
          .payslip-sheet { break-after: page; page-break-after: always; }
          .payslip-sheet:last-child { break-after: auto; page-break-after: auto; }
        }
        @media screen {
          /* Sheets are a fixed 210mm so the preview is what prints. Scroll a
             narrow window rather than shrinking them out of true. */
          .payslip-container { padding: 20px 0 40px; background: #e8e8e8; overflow-x: auto; }
          .payslip-sheet { margin: 0 auto 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
        }
        .payslip-sheet {
          width: 210mm;
          height: 296.9mm; /* not 297mm: Chrome's mm->px rounding otherwise
                              emits a blank page between sheets */
          box-sizing: border-box;
          background: #fff;
          overflow: hidden;
          break-inside: avoid;
        }
        .payslip-slot {
          box-sizing: border-box;
          height: 99mm;
          overflow: hidden;
          padding: 6mm 9mm;
          display: flex;
          flex-direction: column;
        }
        /* absorbs the 0.1mm shaved off the sheet, so slots 1 and 2 stay exact */
        .payslip-slot:nth-child(3) { height: 98.9mm; }
        .payslip-slot.cut-line { border-bottom: 1px dashed #999; }
        .payslip-page {
          font-family: Arial, Helvetica, sans-serif;
          color: #000;
          background: #fff;
        }
        .payslip-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid #000;
        }
        .payslip-header h1 {
          font-size: 18px;
          font-weight: 700;
          margin: 0;
          line-height: 1.2;
        }
        .payslip-header .period {
          font-size: 11px;
          font-weight: 700;
          text-align: right;
          line-height: 1.4;
        }
        .payslip-table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
          margin-bottom: 8px;
          font-size: 11px;
        }
        .payslip-table th {
          padding: 4px 6px;
          text-align: left;
          font-weight: 700;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          border-bottom: 1px solid #000;
        }
        .payslip-table th.num { text-align: right; }
        .payslip-table td {
          padding: 3px 6px;
          border-bottom: 1px solid #ddd;
        }
        .payslip-table td.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .payslip-table tr:last-child td { border-bottom: 1px solid #000; }
        .payslip-table tfoot td {
          padding: 4px 6px;
          font-weight: 700;
          border-bottom: none;
          border-top: 1px solid #000;
        }
        /* Adjustment reason lives under the table, not in a table cell: it is
           the only free-text field on the slip and a fixed-height slot cannot
           absorb it growing. The box is a fixed two lines tall so the summary
           below it never moves, whatever the reason says. */
        .payslip-reason {
          border: 1px solid #000;
          padding: 5px 12px;
          margin-bottom: 6px;
        }
        .payslip-reason .reason-label {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          margin-bottom: 2px;
          color: #333;
        }
        .payslip-reason .reason-body {
          font-size: 11px;
          line-height: 1.3;
          height: 2.6em; /* exactly two lines */
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          overflow-wrap: anywhere;
        }
        .payslip-reason .reason-store { font-weight: 700; }
        .payslip-summary {
          border: 1px solid #000;
          padding: 8px 12px;
          display: flex;
          justify-content: space-between;
          gap: 20px;
        }
        .payslip-summary .summary-item {
          flex: 1;
        }
        .payslip-summary .summary-label {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          margin-bottom: 2px;
          color: #333;
        }
        .payslip-summary .summary-value {
          font-size: 16px;
          font-weight: 700;
        }
      `}</style>

      <div className="no-print" style={{ textAlign: "center", padding: "12px", background: "#f5f5f5", borderBottom: "1px solid #ddd" }}>
        <button
          onClick={() => window.print()}
          style={{ padding: "8px 24px", fontSize: "14px", fontWeight: 600, cursor: "pointer", marginRight: "12px", background: "#000", color: "#fff", border: "none", borderRadius: "4px" }}
          data-testid="button-print-slips"
        >
          Print
        </button>
        <button
          onClick={() => setLocation("/admin/payrolls")}
          style={{ padding: "8px 24px", fontSize: "14px", cursor: "pointer", background: "#fff", border: "1px solid #ccc", borderRadius: "4px" }}
          data-testid="button-back-payrolls"
        >
          Back to Payrolls
        </button>
        {/* Manager-reachable screen, so English only (see PLAN §5, 2026-06-21). */}
        <div style={{ marginTop: "8px", fontSize: "12px", color: "#555" }} data-testid="text-print-settings-hint">
          3 slips per A4 sheet. The cut lines print in the same place on every sheet, so a stack can be cut in one go.<br />
          Print settings: <strong>Scale 100%</strong>, <strong>Margins: None</strong>, <strong>Headers and footers: off</strong> — any other scale shifts the cut lines.
        </div>
      </div>

      <div className="payslip-container">
        {sheets.map((sheet, sheetIdx) => (
          <div key={sheetIdx} className="payslip-sheet" data-testid={`payslip-sheet-${sheetIdx}`}>
            {sheet.map((slip, slotIdx) => (
              <div
                key={slip ? slip.employee.id : `empty-${slotIdx}`}
                /* slots 1 and 2 carry the cut line; slot 3 ends at the paper edge.
                   Empty slots on a partial last sheet still draw it, so the last
                   sheet cuts at the same place as every other sheet. */
                className={`payslip-slot${slotIdx < SLOTS_PER_SHEET - 1 ? " cut-line" : ""}`}
                data-testid={`payslip-slot-${sheetIdx}-${slotIdx}`}
              >
                {slip && renderSlip(slip)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// The reason box is per-slip but reasons are per-store, so prefix the store
// name only when more than one store actually carries a reason — the common
// single-store case reads as a plain sentence.
function renderReasons(entries: SlipEntry[]) {
  const withReason = entries.filter((e) => (e.adjustmentReason || "").trim().length > 0);
  if (withReason.length === 0) return null;
  return withReason.map((entry, idx) => {
    // §6.3.12 Back-pay highlight: adjustment that originated from
    // late-approved shifts in prior periods is tagged in adjustmentReason.
    const isBackPay = !!entry.adjustmentReason?.toLowerCase().includes("back pay");
    return (
      <span key={idx} style={isBackPay ? { color: "#b45309" } : undefined}>
        {idx > 0 && " · "}
        {withReason.length > 1 && <span className="reason-store">{storeCode(entry.storeName)}: </span>}
        {isBackPay && <strong>Back Pay — </strong>}
        {entry.adjustmentReason}
      </span>
    );
  });
}

function renderSlip(slip: PaySlip) {
  const displayName = slip.employee.nickname || slip.employee.name;
  return (
    <div className="payslip-page" data-testid={`payslip-${slip.employee.id}`}>
      <div className="payslip-header">
        <h1 data-testid={`text-employee-name-${slip.employee.id}`}>{displayName}</h1>
        <div className="period" data-testid={`text-period-${slip.employee.id}`}>
          From {formatDate(slip.periodStart)}<br />
          To {formatDate(slip.periodEnd)}
        </div>
      </div>

      <table className="payslip-table">
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Location</th>
            <th className="num">Hours</th>
            <th className="num">Total</th>
            <th className="num">Adjustment</th>
            <th className="num">Envelope</th>
            <th className="num">Deposit</th>
          </tr>
        </thead>
        <tbody>
          {slip.entries.map((entry, idx) => {
            // §6.3.12 Back-pay highlight: adjustment that originated from
            // late-approved shifts in prior periods is tagged in adjustmentReason.
            const isBackPay = !!entry.adjustmentReason?.toLowerCase().includes("back pay");
            return (
              <tr key={idx}>
                <td>{storeCode(entry.storeName)}</td>
                <td className="num">{entry.hours > 0 ? entry.hours.toFixed(1) : "-"}</td>
                <td className="num">{fmtMoney(entry.grossAmount)}</td>
                <td className="num" style={isBackPay ? { color: "#b45309", fontWeight: 600 } : undefined}>
                  {entry.adjustment !== 0 ? fmtMoney(entry.adjustment) : "-"}
                </td>
                <td className="num">{fmtMoney(entry.cashAmount)}</td>
                <td className="num">{fmtMoney(entry.bankDepositAmount)}</td>
              </tr>
            );
          })}
        </tbody>
        {slip.entries.length > 1 && (
          <tfoot>
            <tr>
              {/* Left blank: the Gross column header is now "Total", and a
                  second "Total" in the row label read as the same thing. */}
              <td></td>
              <td className="num">{slip.grandTotals.hours > 0 ? slip.grandTotals.hours.toFixed(1) : "-"}</td>
              <td className="num">{fmtMoney(slip.grandTotals.grossAmount)}</td>
              <td className="num"></td>
              <td className="num">{fmtMoney(slip.grandTotals.cashAmount)}</td>
              <td className="num">{fmtMoney(slip.grandTotals.bankDepositAmount)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      <div className="payslip-reason" data-testid={`reason-${slip.employee.id}`}>
        <div className="reason-label">Adjustment Reason</div>
        <div className="reason-body">{renderReasons(slip.entries)}</div>
      </div>

      <div className="payslip-summary">
        <div className="summary-item">
          <div className="summary-label">Envelope</div>
          <div className="summary-value" data-testid={`text-total-cash-${slip.employee.id}`}>
            {fmtMoney(slip.grandTotals.cashAmount)}
          </div>
        </div>
        <div className="summary-item" style={{ textAlign: "right" }}>
          <div className="summary-label">Deposit</div>
          <div className="summary-value" data-testid={`text-total-bank-${slip.employee.id}`}>
            {fmtMoney(slip.grandTotals.bankDepositAmount)}
          </div>
        </div>
      </div>
    </div>
  );
}
