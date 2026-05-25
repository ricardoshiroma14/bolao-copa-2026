export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admin_emails: {
        Row: {
          created_at: string;
          email: string;
        };
        Insert: {
          created_at?: string;
          email: string;
        };
        Update: {
          created_at?: string;
          email?: string;
        };
        Relationships: [];
      };
      bracket_predictions: {
        Row: {
          away_score: number | null;
          created_at: string;
          home_score: number | null;
          id: string;
          points: number;
          pool_id: string;
          slot: number;
          stage: Database["public"]["Enums"]["match_stage"];
          team_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          away_score?: number | null;
          created_at?: string;
          home_score?: number | null;
          id?: string;
          points?: number;
          pool_id: string;
          slot: number;
          stage: Database["public"]["Enums"]["match_stage"];
          team_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          away_score?: number | null;
          created_at?: string;
          home_score?: number | null;
          id?: string;
          points?: number;
          pool_id?: string;
          slot?: number;
          stage?: Database["public"]["Enums"]["match_stage"];
          team_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bracket_predictions_pool_id_fkey";
            columns: ["pool_id"];
            isOneToOne: false;
            referencedRelation: "pools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bracket_predictions_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      champion_predictions: {
        Row: {
          created_at: string;
          id: string;
          points: number;
          pool_id: string;
          team_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          points?: number;
          pool_id: string;
          team_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          points?: number;
          pool_id?: string;
          team_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "champion_predictions_pool_id_fkey";
            columns: ["pool_id"];
            isOneToOne: false;
            referencedRelation: "pools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "champion_predictions_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      matches: {
        Row: {
          away_penalties: number | null;
          away_score: number | null;
          away_team_id: string | null;
          created_at: string;
          external_id: string | null;
          group_name: string | null;
          home_penalties: number | null;
          home_score: number | null;
          home_team_id: string | null;
          id: string;
          kickoff_at: string;
          stage: Database["public"]["Enums"]["match_stage"];
          status: Database["public"]["Enums"]["match_status"];
          updated_at: string;
          venue: string | null;
          winner_team_id: string | null;
        };
        Insert: {
          away_penalties?: number | null;
          away_score?: number | null;
          away_team_id?: string | null;
          created_at?: string;
          external_id?: string | null;
          group_name?: string | null;
          home_penalties?: number | null;
          home_score?: number | null;
          home_team_id?: string | null;
          id?: string;
          kickoff_at: string;
          stage?: Database["public"]["Enums"]["match_stage"];
          status?: Database["public"]["Enums"]["match_status"];
          updated_at?: string;
          venue?: string | null;
          winner_team_id?: string | null;
        };
        Update: {
          away_penalties?: number | null;
          away_score?: number | null;
          away_team_id?: string | null;
          created_at?: string;
          external_id?: string | null;
          group_name?: string | null;
          home_penalties?: number | null;
          home_score?: number | null;
          home_team_id?: string | null;
          id?: string;
          kickoff_at?: string;
          stage?: Database["public"]["Enums"]["match_stage"];
          status?: Database["public"]["Enums"]["match_status"];
          updated_at?: string;
          venue?: string | null;
          winner_team_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "matches_away_team_id_fkey";
            columns: ["away_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "matches_home_team_id_fkey";
            columns: ["home_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      pool_members: {
        Row: {
          has_paid: boolean;
          id: string;
          joined_at: string;
          paid_at: string | null;
          paid_confirmed_by: string | null;
          pool_id: string;
          user_id: string;
        };
        Insert: {
          has_paid?: boolean;
          id?: string;
          joined_at?: string;
          paid_at?: string | null;
          paid_confirmed_by?: string | null;
          pool_id: string;
          user_id: string;
        };
        Update: {
          has_paid?: boolean;
          id?: string;
          joined_at?: string;
          paid_at?: string | null;
          paid_confirmed_by?: string | null;
          pool_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pool_members_pool_id_fkey";
            columns: ["pool_id"];
            isOneToOne: false;
            referencedRelation: "pools";
            referencedColumns: ["id"];
          },
        ];
      };
      pools: {
        Row: {
          bonus_champion: number;
          bonus_final: number;
          bonus_final_wrong: number;
          bonus_quarter: number;
          bonus_quarter_wrong: number;
          bonus_round_of_16: number;
          bonus_round_of_16_wrong: number;
          bonus_round_of_32: number;
          bonus_round_of_32_wrong: number;
          bonus_semi: number;
          bonus_semi_wrong: number;
          bonus_third_place: number;
          bonus_third_place_wrong: number;
          created_at: string;
          description: string | null;
          id: string;
          invite_code: string;
          name: string;
          owner_id: string;
          round_of_32_points_enabled: boolean;
          scoring_diff: number;
          scoring_exact: number;
          scoring_winner: number;
        };
        Insert: {
          bonus_champion?: number;
          bonus_final?: number;
          bonus_final_wrong?: number;
          bonus_quarter?: number;
          bonus_quarter_wrong?: number;
          bonus_round_of_16?: number;
          bonus_round_of_16_wrong?: number;
          bonus_round_of_32?: number;
          bonus_round_of_32_wrong?: number;
          bonus_semi?: number;
          bonus_semi_wrong?: number;
          bonus_third_place?: number;
          bonus_third_place_wrong?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          invite_code?: string;
          name: string;
          owner_id: string;
          round_of_32_points_enabled?: boolean;
          scoring_diff?: number;
          scoring_exact?: number;
          scoring_winner?: number;
        };
        Update: {
          bonus_champion?: number;
          bonus_final?: number;
          bonus_final_wrong?: number;
          bonus_quarter?: number;
          bonus_quarter_wrong?: number;
          bonus_round_of_16?: number;
          bonus_round_of_16_wrong?: number;
          bonus_round_of_32?: number;
          bonus_round_of_32_wrong?: number;
          bonus_semi?: number;
          bonus_semi_wrong?: number;
          bonus_third_place?: number;
          bonus_third_place_wrong?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          invite_code?: string;
          name?: string;
          owner_id?: string;
          round_of_32_points_enabled?: boolean;
          scoring_diff?: number;
          scoring_exact?: number;
          scoring_winner?: number;
        };
        Relationships: [];
      };
      predictions: {
        Row: {
          away_score: number;
          created_at: string;
          home_score: number;
          id: string;
          match_id: string;
          points: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          away_score: number;
          created_at?: string;
          home_score: number;
          id?: string;
          match_id: string;
          points?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          away_score?: number;
          created_at?: string;
          home_score?: number;
          id?: string;
          match_id?: string;
          points?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "predictions_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name: string;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          code: string;
          created_at: string;
          external_id: string | null;
          flag_url: string | null;
          group_name: string | null;
          id: string;
          name: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          external_id?: string | null;
          flag_url?: string | null;
          group_name?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          external_id?: string | null;
          flag_url?: string | null;
          group_name?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_pool_member: {
        Args: { _pool_id: string; _user_id: string };
        Returns: boolean;
      };
      join_pool_by_invite_code: {
        Args: { _invite_code: string };
        Returns: string;
      };
    };
    Enums: {
      app_role: "admin" | "user";
      match_stage:
        | "group"
        | "round_of_32"
        | "round_of_16"
        | "quarter"
        | "semi"
        | "third_place"
        | "final";
      match_status: "scheduled" | "live" | "finished" | "postponed" | "cancelled";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      match_stage: [
        "group",
        "round_of_32",
        "round_of_16",
        "quarter",
        "semi",
        "third_place",
        "final",
      ],
      match_status: ["scheduled", "live", "finished", "postponed", "cancelled"],
    },
  },
} as const;
