import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="grid gap-2 grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
      {balances.map((b) => (
        <Card key={b.code} className="py-0">
          <CardContent className="px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground" data-testid={`text-balance-name-${b.code}`}>
              {b.name}
            </span>
            <span
              className={`block text-sm font-bold font-mono ${b.cash < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              data-testid={`text-balance-cash-${b.code}`}
            >
              ${b.cash.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
