
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('video','file')),
  title text NOT NULL,
  description text,
  tags text[] NOT NULL DEFAULT '{}',
  file_url text NOT NULL,
  thumbnail_url text,
  mime_type text,
  size_bytes bigint,
  duration_seconds integer,
  is_public boolean NOT NULL DEFAULT true,
  view_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Documents readable" ON public.documents FOR SELECT
  USING (is_public = true OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Super admin manage documents" ON public.documents FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER documents_updated_at
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_documents_kind_created ON public.documents(kind, created_at DESC);

INSERT INTO storage.buckets (id, name, public) VALUES ('documents','documents', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Documents bucket public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'documents');

CREATE POLICY "Super admin upload documents" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'documents' AND has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Super admin update documents" ON storage.objects FOR UPDATE
  USING (bucket_id = 'documents' AND has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Super admin delete documents" ON storage.objects FOR DELETE
  USING (bucket_id = 'documents' AND has_role(auth.uid(), 'super_admin'::app_role));
