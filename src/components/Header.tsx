import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Trophy, LogOut, User as UserIcon, Shield, ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useAdminView } from "@/lib/admin-view";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Header() {
  const { user, loading, signOut } = useAuth();
  const { viewMode, setViewMode } = useAdminView();
  const location = useLocation();
  const navigate = useNavigate();

  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
  });

  const currentViewLabel = viewMode === "user" ? "User" : "Admin";
  const CurrentViewIcon = viewMode === "user" ? UserIcon : Shield;

  const handleViewModeChange = (mode: string) => {
    if (mode !== "admin" && mode !== "user") return;
    setViewMode(mode);
    if (mode === "user" && location.pathname.startsWith("/admin")) {
      navigate({ to: "/dashboard" });
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 text-foreground">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Trophy className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold uppercase tracking-wider">Bolão</div>
            <div className="text-[10px] text-muted-foreground -mt-0.5">Copa do Mundo</div>
          </div>
        </Link>
        <nav className="flex items-center gap-2">
          {loading ? (
            <div className="h-9 w-24 rounded-md bg-muted/40 animate-pulse" aria-hidden />
          ) : user ? (
            <>
              <Link to="/dashboard">
                <Button variant="ghost" size="sm">
                  Bolão
                </Button>
              </Link>
              {isAdmin && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 px-2 sm:px-3"
                    onClick={() => {
                      setViewMode("admin");
                      navigate({ to: "/admin" });
                    }}
                  >
                    <Shield className="h-4 w-4" />
                    <span className="hidden sm:inline">Painel admin</span>
                    <span className="sm:hidden">Admin</span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-1.5 px-2 sm:px-3">
                        <CurrentViewIcon className="h-4 w-4" />
                        <span className="hidden sm:inline">Ver: {currentViewLabel}</span>
                        <span className="sm:hidden">{currentViewLabel}</span>
                        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuLabel>Visualizar como</DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={viewMode} onValueChange={handleViewModeChange}>
                        <DropdownMenuRadioItem value="admin">
                          <Shield className="h-4 w-4" />
                          Admin
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="user">
                          <UserIcon className="h-4 w-4" />
                          User
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
              <Link to="/profile">
                <Button variant="ghost" size="icon">
                  <UserIcon className="h-4 w-4" />
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                onClick={async () => {
                  await signOut();
                  navigate({ to: "/" });
                }}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Link to="/auth">
              <Button size="sm">Entrar</Button>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
