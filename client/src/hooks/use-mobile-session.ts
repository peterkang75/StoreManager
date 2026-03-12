import { useState, useCallback } from "react";

export interface MobileSession {
  id: string;
  name: string;
  role: string;
  storeId: string | null;
  storeIds: string[];
}

const SESSION_KEY = "mobile_session";

function loadSession(): MobileSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MobileSession;
  } catch {
    return null;
  }
}

function saveSession(session: MobileSession | null) {
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

export function useMobileSession() {
  const [session, setSessionState] = useState<MobileSession | null>(loadSession);

  const setSession = useCallback((s: MobileSession | null) => {
    saveSession(s);
    setSessionState(s);
  }, []);

  const clearSession = useCallback(() => {
    saveSession(null);
    setSessionState(null);
  }, []);

  return { session, setSession, clearSession };
}
