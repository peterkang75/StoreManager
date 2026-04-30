import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Portal Bearer-token key — set by EmployeePortal.tsx on login.
export const PORTAL_TOKEN_KEY = "ep_portal_token_v1";

// Wrap window.fetch so every /api/portal/* request automatically includes the
// portal Bearer token (read from localStorage). Non-portal calls are
// untouched. This avoids editing dozens of fetch sites scattered around the
// mobile pages.
if (typeof window !== "undefined" && !(window as any).__crewPortalFetchPatched) {
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = "";
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else if ((input as Request).url) url = (input as Request).url;
    if (url && (url.startsWith("/api/portal/") || url.includes("/api/portal/"))) {
      try {
        const token = localStorage.getItem(PORTAL_TOKEN_KEY);
        if (token) {
          init = init || {};
          const headers = new Headers(init.headers || {});
          if (!headers.has("Authorization") && !headers.has("authorization")) {
            headers.set("Authorization", `Bearer ${token}`);
          }
          init.headers = headers;
        }
      } catch {}
    }
    return orig(input, init);
  };
  (window as any).__crewPortalFetchPatched = true;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { timeoutMs?: number },
): Promise<Response> {
  const controller = options?.timeoutMs ? new AbortController() : undefined;
  const timer = controller
    ? setTimeout(() => controller.abort(), options!.timeoutMs)
    : undefined;

  try {
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal: controller?.signal,
    });
    await throwIfResNotOk(res);
    return res;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error("Request timed out — please try again.");
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
