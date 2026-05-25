import { useContext } from "react";
import { AdminViewContext } from "@/lib/admin-view-context";

export function useAdminView() {
  const ctx = useContext(AdminViewContext);
  if (!ctx) throw new Error("useAdminView must be used within AdminViewProvider");
  return ctx;
}

export function useEffectiveAdmin(realIsAdmin: boolean | undefined) {
  const { viewMode } = useAdminView();
  return realIsAdmin === true && viewMode === "admin";
}
