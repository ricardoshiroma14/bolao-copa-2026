import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ADMIN_VIEW_STORAGE_KEY,
  AdminViewContext,
  type AdminViewMode,
} from "@/lib/admin-view-context";

export function AdminViewProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewModeState] = useState<AdminViewMode>("admin");

  useEffect(() => {
    const saved = window.localStorage.getItem(ADMIN_VIEW_STORAGE_KEY);
    if (saved === "admin" || saved === "user") setViewModeState(saved);
  }, []);

  const setViewMode = useCallback((mode: AdminViewMode) => {
    setViewModeState(mode);
    window.localStorage.setItem(ADMIN_VIEW_STORAGE_KEY, mode);
  }, []);

  const value = useMemo(() => ({ viewMode, setViewMode }), [viewMode, setViewMode]);

  return <AdminViewContext.Provider value={value}>{children}</AdminViewContext.Provider>;
}
