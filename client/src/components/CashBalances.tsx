import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import type { Store } from "@shared/schema";

const balanceDisplayOrder = ["Sushi", "Sandwich", "Trading", "HO"];

interface CashBalancesProps {
  stores: Store[];
  draftByStore?: Record<string, number>; // storeId → draft cash outflow
}

export function CashBalances({ stores, draftByStore }: CashBalancesProps) {
  const { data: serverBalances } = useQuery<Record<string, number>>({
    queryKey: ["/api/finance/balances"],
  });

  const internalStores = stores.filter((s) => s.active && !s.isExternal);

  const balances = balanceDisplayOrder
    .map((name) => {
      if (!serverBalances) return null;
      const store = internalStores.find((s) => s.name === name);
      if (!store) return null;
      const balance = serverBalances[name];
      if (balance === undefined) return null;
      const draftOutflow = draftByStore?.[store.id];
      const draftBalance = draftOutflow != null && draftOutflow > 0
        ? balance - draftOutflow
        : null;
      return { name, code: store.code, balance, draftBalance };
    })
    .filter(Boolean) as { name: string; code: string; balance: number; draftBalance: number | null }[];

  if (balances.length === 0) return null;

  return (
    <div className="grid gap-2 grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
      {balances.map((b) => (
        <Card key={b.code} className="py-0">
          <CardContent className="px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground" data-testid={`text-balance-name-${b.code}`}>
              {b.name}
            </span>
            <span
              className={`block text-sm font-bold font-mono ${b.balance < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              data-testid={`text-balance-cash-${b.code}`}
            >
              ${b.balance.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {b.draftBalance != null && (
              <span
                className={`block text-xs font-mono mt-0.5 ${b.draftBalance < 0 ? "text-red-500" : "text-amber-600 dark:text-amber-400"}`}
                data-testid={`text-balance-draft-${b.code}`}
              >
                Draft: ${b.draftBalance.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}