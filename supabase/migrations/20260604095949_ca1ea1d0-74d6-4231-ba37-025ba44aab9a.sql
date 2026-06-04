-- Status de aprovação, requisitante e URL de cotação para o catálogo
CREATE TYPE public.asset_status AS ENUM ('pending', 'approved');

ALTER TABLE public.assets
  ADD COLUMN status public.asset_status NOT NULL DEFAULT 'approved',
  ADD COLUMN requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN quote_url text,
  ADD COLUMN updated_at timestamp with time zone NOT NULL DEFAULT now();

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.assets_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER assets_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.assets_set_updated_at();

-- Permitir que usuários autenticados solicitem inclusão (status pending)
CREATE POLICY "assets_request_pending"
  ON public.assets FOR INSERT
  TO authenticated
  WITH CHECK (status = 'pending' AND requested_by = auth.uid());

CREATE INDEX assets_status_idx ON public.assets(status);