import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Bearer-token keys — set by login flows.
//   ep_portal_token_v1 — EmployeePortal PIN login (1-day TTL)
//   admin_token_v1     — AuthContext email/password login (30-day TTL)
export const PORTAL_TOKEN_KEY = "ep_portal_token_v1";
export const ADMIN_TOKEN_KEY = "admin_token_v1";

// Pick the right token for an outgoing /api/* request:
//   - /api/portal/*  → portal token (PIN session)
//   - everything else → admin token if present, otherwise portal token (mobile pages
//     also call shared /api/* endpoints; portal session is the right one for them)
function pickToken(url: string): string | null {
  try {
    if (url.includes("/api/portal/")) {
      return localStorage.getItem(PORTAL_TOKEN_KEY);
    }
    return localStorage.getItem(ADMIN_TOKEN_KEY) || localStorage.getItem(PORTAL_TOKEN_KEY);
  } catch {
    return null;
  }
}

// On 401 we redirect to the appropriate login screen. Avoid loops on the
// login page itself + on the /api/auth/me probe (AuthContext handles its own).
function handle401(url: string) {
  try {
    const path = window.location.pathname;
    if (path === "/admin/login") return;
    if (url.endsWith("/api/auth/me")) return;
    // Portal employees see the PIN screen; admins see /admin/login.
    if (path.startsWith("/m/")) {
      // Portal token expired → clear so PIN screen is forced
      localStorage.removeItem(PORTAL_TOKEN_KEY);
      return;
    }
    if (path.startsWith("/admin")) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      const redirect = encodeURIComponent(path + window.location.search);
      window.location.href = `/admin/login?redirect=${redirect}`;
    }
  } catch {}
}

// Wrap window.fetch to:
//   1. Auto-inject Authorization: Bearer for /api/* calls (admin or portal token)
//   2. Auto-redirect on 401 to the appropriate login flow
if (typeof window !== "undefined" && !(window as any).__crewPortalFetchPatched) {
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = "";
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else if ((input as Request).url) url = (input as Request).url;

    const isApi = url && (url.startsWith("/api/") || url.includes("/api/"));
    if (isApi) {
      const token = pickToken(url);
      if (token) {
        init = init || {};
        const headers = new Headers(init.headers || {});
        if (!headers.has("Authorization") && !headers.has("authorization")) {
          headers.set("Authorization", `Bearer ${token}`);
        }
        init.headers = headers;
      }
    }

    const res = await orig(input, init);
    if (isApi && res.status === 401) {
      handle401(url);
    }
    return res;
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
