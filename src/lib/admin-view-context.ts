import { createContext } from "react";

export type AdminViewMode = "admin" | "user";

export type AdminViewContextValue = {
  viewMode: AdminViewMode;
  setViewMode: (mode: AdminViewMode) => void;
};

export const ADMIN_VIEW_STORAGE_KEY = "bolao-admin-view-mode";

export const AdminViewContext = createContext<AdminViewContextValue | undefined>(undefined);
