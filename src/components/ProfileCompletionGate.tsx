import { useEffect } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { isProfileComplete } from "@/lib/profile-completion";
import { supabase } from "@/integrations/supabase/client";

const COMPLETION_EXEMPT_PATHS = new Set(["/auth", "/complete-profile", "/reset-password"]);

export function ProfileCompletionGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isExemptPath = COMPLETION_EXEMPT_PATHS.has(location.pathname);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile-completion", user?.id],
    enabled: !!user && !isExemptPath,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (loading || !user || isExemptPath || profileLoading) return;
    if (!isProfileComplete(user, profile ?? null)) {
      navigate({ to: "/complete-profile", replace: true });
    }
  }, [isExemptPath, loading, navigate, profile, profileLoading, user]);

  return <>{children}</>;
}
