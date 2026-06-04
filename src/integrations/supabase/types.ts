export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      asset_prices: {
        Row: {
          asset_id: string
          close_price: number
          fetched_at: string
          price_date: string
          source: string | null
        }
        Insert: {
          asset_id: string
          close_price: number
          fetched_at?: string
          price_date: string
          source?: string | null
        }
        Update: {
          asset_id?: string
          close_price?: number
          fetched_at?: string
          price_date?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_prices_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          asset_class: Database["public"]["Enums"]["asset_class"]
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          data_source: string | null
          external_id: string | null
          id: string
          name: string | null
          quote_url: string | null
          requested_by: string | null
          status: Database["public"]["Enums"]["asset_status"]
          symbol: string
          updated_at: string
        }
        Insert: {
          asset_class: Database["public"]["Enums"]["asset_class"]
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          data_source?: string | null
          external_id?: string | null
          id?: string
          name?: string | null
          quote_url?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["asset_status"]
          symbol: string
          updated_at?: string
        }
        Update: {
          asset_class?: Database["public"]["Enums"]["asset_class"]
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          data_source?: string | null
          external_id?: string | null
          id?: string
          name?: string | null
          quote_url?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["asset_status"]
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          base: Database["public"]["Enums"]["currency_code"]
          quote: Database["public"]["Enums"]["currency_code"]
          rate: number
          rate_date: string
        }
        Insert: {
          base: Database["public"]["Enums"]["currency_code"]
          quote: Database["public"]["Enums"]["currency_code"]
          rate: number
          rate_date: string
        }
        Update: {
          base?: Database["public"]["Enums"]["currency_code"]
          quote?: Database["public"]["Enums"]["currency_code"]
          rate?: number
          rate_date?: string
        }
        Relationships: []
      }
      portfolio_snapshots: {
        Row: {
          base_currency: Database["public"]["Enums"]["currency_code"]
          id: string
          pnl: number
          snapshot_date: string
          total_invested: number
          total_value: number
          user_id: string
        }
        Insert: {
          base_currency: Database["public"]["Enums"]["currency_code"]
          id?: string
          pnl: number
          snapshot_date: string
          total_invested: number
          total_value: number
          user_id: string
        }
        Update: {
          base_currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          pnl?: number
          snapshot_date?: string
          total_invested?: number
          total_value?: number
          user_id?: string
        }
        Relationships: []
      }
      price_fetch_failures: {
        Row: {
          asset_id: string | null
          created_at: string
          id: string
          reason: string | null
          resolved: boolean
          symbol: string | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          resolved?: boolean
          symbol?: string | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          resolved?: boolean
          symbol?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_fetch_failures_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          base_currency: Database["public"]["Enums"]["currency_code"]
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          base_currency?: Database["public"]["Enums"]["currency_code"]
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          base_currency?: Database["public"]["Enums"]["currency_code"]
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          asset_id: string
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          fees: number
          id: string
          notes: string | null
          occurred_at: string
          quantity: number
          tx_type: Database["public"]["Enums"]["tx_type"]
          unit_price: number
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          fees?: number
          id?: string
          notes?: string | null
          occurred_at: string
          quantity: number
          tx_type: Database["public"]["Enums"]["tx_type"]
          unit_price: number
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          fees?: number
          id?: string
          notes?: string | null
          occurred_at?: string
          quantity?: number
          tx_type?: Database["public"]["Enums"]["tx_type"]
          unit_price?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "premium" | "free"
      asset_class:
        | "stock"
        | "reit"
        | "etf"
        | "crypto"
        | "fixed_income"
        | "fund"
        | "cash"
        | "other"
      asset_status: "pending" | "approved"
      currency_code: "BRL" | "USD" | "EUR" | "GBP" | "JPY"
      tx_type: "buy" | "sell" | "dividend" | "deposit" | "withdraw"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "premium", "free"],
      asset_class: [
        "stock",
        "reit",
        "etf",
        "crypto",
        "fixed_income",
        "fund",
        "cash",
        "other",
      ],
      asset_status: ["pending", "approved"],
      currency_code: ["BRL", "USD", "EUR", "GBP", "JPY"],
      tx_type: ["buy", "sell", "dividend", "deposit", "withdraw"],
    },
  },
} as const
