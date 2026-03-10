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
      .then((data) => {
        setSlips(data);
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

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; padding: 0; }
          .payslip-page { page-break-after: always; }
          .payslip-page:last-child { page-break-after: avoid; }
          .no-print { display: none !important; }
        }
        @media screen {
          .payslip-container { max-width: 800px; margin: 0 auto; padding: 20px; }
        }
        .payslip-page {
          font-family: Arial, Helvetica, sans-serif;
          color: #000;
          background: #fff;
          padding: 24px;
        }
        .payslip-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 20px;
          padding-bottom: 12px;
          border-bottom: 3px solid #000;
        }
        .payslip-header h1 {
          font-size: 24px;
          font-weight: 700;
          margin: 0;
          line-height: 1.2;
        }
        .payslip-header .period {
          font-size: 14px;
          font-weight: 700;
          text-align: right;
          line-height: 1.5;
        }
        .payslip-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
          font-size: 13px;
        }
        .payslip-table th {
          background: #000;
          color: #fff;
          padding: 8px 10px;
          text-align: left;
          font-weight: 600;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .payslip-table th.num { text-align: right; }
        .payslip-table td {
          padding: 7px 10px;
          border-bottom: 1px solid #ddd;
        }
        .payslip-table td.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .payslip-table tr:last-child td { border-bottom: 2px solid #000; }
        .payslip-table tfoot td {
          padding: 8px 10px;
          font-weight: 700;
          border-bottom: none;
          border-top: 2px solid #000;
        }
        .payslip-summary {
          border: 3px solid #000;
          padding: 16px 20px;
          display: flex;
          justify-content: space-between;
          gap: 40px;
        }
        .payslip-summary .summary-item {
          flex: 1;
        }
        .payslip-summary .summary-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
          color: #333;
        }
        .payslip-summary .summary-value {
          font-size: 22px;
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
      </div>

      <div className="payslip-container">
        {slips.map((slip) => {
          const displayName = slip.employee.nickname || slip.employee.name;
          return (
            <div key={slip.employee.id} className="payslip-page" data-testid={`payslip-${slip.employee.id}`}>
              <div className="payslip-header">
                <h1 data-testid={`text-employee-name-${slip.employee.id}`}>{displayName}</h1>
                <div className="period" data-testid={`text-period-${slip.employee.id}`}>
                  From {formatDate(slip.periodStart)}<br />
                  To {formatDate(slip.periodEnd)}
                </div>
              </div>

              <table className="payslip-table">
                <thead>
                  <tr>
                    <th>Store</th>
                    <th className="num">Hours</th>
                    <th className="num">Gross</th>
                    <th className="num">Adjustment</th>
                    <th>Reason</th>
                    <th className="num">Cash (Env)</th>
                    <th className="num">Bank Deposit</th>
                  </tr>
                </thead>
                <tbody>
                  {slip.entries.map((entry, idx) => (
                    <tr key={idx}>
                      <td>{entry.storeName}</td>
                      <td className="num">{entry.hours > 0 ? entry.hours.toFixed(1) : "-"}</td>
                      <td className="num">{fmtMoney(entry.grossAmount)}</td>
                      <td className="num">{entry.adjustment !== 0 ? fmtMoney(entry.adjustment) : "-"}</td>
                      <td>{entry.adjustmentReason || ""}</td>
                      <td className="num">{fmtMoney(entry.cashAmount)}</td>
                      <td className="num">{fmtMoney(entry.bankDepositAmount)}</td>
                    </tr>
                  ))}
                </tbody>
                {slip.entries.length > 1 && (
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num">{slip.grandTotals.hours > 0 ? slip.grandTotals.hours.toFixed(1) : "-"}</td>
                      <td className="num">{fmtMoney(slip.grandTotals.grossAmount)}</td>
                      <td className="num"></td>
                      <td></td>
                      <td className="num">{fmtMoney(slip.grandTotals.cashAmount)}</td>
                      <td className="num">{fmtMoney(slip.grandTotals.bankDepositAmount)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>

              <div className="payslip-summary">
                <div className="summary-item">
                  <div className="summary-label">Total Cash for Envelope</div>
                  <div className="summary-value" data-testid={`text-total-cash-${slip.employee.id}`}>
                    {fmtMoney(slip.grandTotals.cashAmount)}
                  </div>
                </div>
                <div className="summary-item" style={{ textAlign: "right" }}>
                  <div className="summary-label">Total Bank Transfer</div>
                  <div className="summary-value" data-testid={`text-total-bank-${slip.employee.id}`}>
                    {fmtMoney(slip.grandTotals.bankDepositAmount)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
