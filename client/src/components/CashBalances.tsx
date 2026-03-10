import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Store } from "@shared/schema";

const balanceDisplayOrder = ["Sushi", "Sandwich", "Trading", "HO"];

export function CashBalances({ stores }: { stores: Store[] }) {
  const { data: serverBalances } = useQuery<Record<string, number>>({
    queryKey: ["/api/finance/balances"],
  });

  const internalStores = stores.filter((s) => s.active && !s.isExternal);

  const balances = balanceDisplayOrder
    .map((name) => {
      if (!serverBalances) return null;
      const store = internalStores.find((s) => s.name === name);
      if (!store) return null;
      const cash = serverBalances[name];
      if (cash === undefined) return null;
      return { name, code: store.code, cash };
    })
    .filter(Boolean) as { name: string; code: string; cash: number }[];

  if (balances.length === 0) return null;

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      {balances.map((b) => (
        <Card key={b.code}>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground" data-testid={`text-balance-name-${b.code}`}>
              {b.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <span
              className={`text-xl font-bold font-mono ${b.cash < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              data-testid={`text-balance-cash-${b.code}`}
            >
              ${b.cash.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <p className="text-xs text-muted-foreground mt-1">Cash Balance</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
