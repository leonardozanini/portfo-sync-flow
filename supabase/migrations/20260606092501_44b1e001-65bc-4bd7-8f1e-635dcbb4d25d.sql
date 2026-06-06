CREATE TYPE public.market_code AS ENUM ('B3','NYSE','NASDAQ','LSE','TSE','CRYPTO','OTHER');

ALTER TABLE public.assets
  ADD COLUMN market public.market_code NOT NULL DEFAULT 'OTHER';

UPDATE public.assets SET market = CASE
  WHEN asset_class = 'crypto' THEN 'CRYPTO'::public.market_code
  WHEN currency = 'BRL' THEN 'B3'::public.market_code
  WHEN currency = 'USD' THEN 'NYSE'::public.market_code
  WHEN currency IN ('EUR','GBP') THEN 'LSE'::public.market_code
  WHEN currency = 'JPY' THEN 'TSE'::public.market_code
  ELSE 'OTHER'::public.market_code
END;

CREATE INDEX IF NOT EXISTS assets_market_idx ON public.assets(market);