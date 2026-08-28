-- Dealer payroll PDF renderer/storage contract v1.
-- CRITICAL / RED: source-only until disposable PG16/17 proof, protected catalog
-- preflight, and TEST-club UAT. This migration must not be applied implicitly.
--
-- Server authority:
--   * the renderer receives only a statement id and mode;
--   * the Edge function obtains the immutable snapshot through the existing RPC;
--   * the PDF object path contains only opaque ids, never names, phones or bank data;
--   * the private bucket is service-role managed and downloads use short signed URLs.
--
-- ROLLBACK: use a forward migration to revoke the service-role marker RPC and
-- stop the renderer. Never delete statement rows, PDF objects or audit evidence.

begin;

do $$
begin
  if to_regclass('public.dealer_payroll_statements') is null
     or to_regclass('public.dealer_payroll_statement_lines') is null
     or to_regclass('storage.buckets') is null then
    raise exception 'PAYROLL_PDF_STORAGE_DEPENDENCY_UNAVAILABLE' using errcode = 'P0001';
  end if;
end;
$$;

alter table public.dealer_payroll_statements
  add column if not exists pdf_hash text
    check (pdf_hash is null or pdf_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_render_version text,
  add column if not exists pdf_rendered_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payroll-statements', 'payroll-statements', false, 5242880, array['application/pdf']::text[])
on conflict (id) do nothing;

create or replace function public.mark_dealer_payroll_statement_pdf_rendered(
  p_statement_id uuid,
  p_pdf_hash text,
  p_storage_path text,
  p_render_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_statement public.dealer_payroll_statements%rowtype;
  v_now timestamptz := now();
begin
  if p_statement_id is null
     or p_pdf_hash is null
     or p_pdf_hash !~ '^[0-9a-f]{64}$'
     or p_storage_path is null
     or p_storage_path !~ '^statements/[0-9a-f-]{36}/[0-9a-f-]{36}/[a-z0-9._-]+\.pdf$'
     or p_render_version is null
     or p_render_version !~ '^[a-z0-9._-]{1,64}$' then
    raise exception 'PAYROLL_PDF_INVALID_MARK_REQUEST' using errcode = 'P0001';
  end if;

  select * into v_statement
  from public.dealer_payroll_statements
  where id = p_statement_id
  for update;
  if not found then
    raise exception 'PAYROLL_STATEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_statement.state in ('voided', 'replaced') then
    raise exception 'PAYROLL_PDF_STATEMENT_NOT_RENDERABLE' using errcode = 'P0001';
  end if;

  if v_statement.pdf_hash is not null then
    if v_statement.pdf_hash <> p_pdf_hash
       or v_statement.pdf_storage_path <> p_storage_path
       or v_statement.pdf_render_version <> p_render_version then
      raise exception 'PAYROLL_PDF_HASH_CONFLICT' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'statement_id', p_statement_id,
      'pdf_hash', v_statement.pdf_hash,
      'pdf_storage_path', v_statement.pdf_storage_path,
      'render_version', v_statement.pdf_render_version,
      'idempotent', true
    );
  end if;

  if v_statement.state not in ('finalized', 'delivery_failed') then
    raise exception 'PAYROLL_STATEMENT_NOT_FINALIZED' using errcode = 'P0001';
  end if;

  update public.dealer_payroll_statements
  set state = 'pdf_rendered',
      pdf_hash = p_pdf_hash,
      pdf_storage_path = p_storage_path,
      pdf_render_version = p_render_version,
      pdf_rendered_at = v_now
  where id = p_statement_id;

  insert into public.payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by, reason)
  values (
    'dealer_payroll_statements', p_statement_id, v_statement.club_id, 'UPDATE',
    jsonb_build_object('state', 'pdf_rendered', 'pdf_hash', p_pdf_hash, 'render_version', p_render_version),
    null, 'Server-rendered immutable payroll PDF'
  );

  return jsonb_build_object(
    'statement_id', p_statement_id,
    'pdf_hash', p_pdf_hash,
    'pdf_storage_path', p_storage_path,
    'render_version', p_render_version,
    'idempotent', false
  );
end;
$$;

revoke all on function public.mark_dealer_payroll_statement_pdf_rendered(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.mark_dealer_payroll_statement_pdf_rendered(uuid, text, text, text) to service_role;

comment on column public.dealer_payroll_statements.pdf_hash is
  'SHA-256 of the deterministic server-rendered PDF bytes; never supplied by a client.';
comment on column public.dealer_payroll_statements.pdf_storage_path is
  'Opaque private-storage path containing club and statement UUIDs only.';
comment on function public.mark_dealer_payroll_statement_pdf_rendered(uuid, text, text, text) is
  'Service-role-only idempotent transition from finalized to pdf_rendered for one immutable snapshot.';

do $$
begin
  if to_regclass('public.dealer_payroll_statements') is null
     or to_regprocedure('public.mark_dealer_payroll_statement_pdf_rendered(uuid,text,text,text)') is null
     or not exists (select 1 from storage.buckets where id = 'payroll-statements' and public = false) then
    raise exception 'PAYROLL_PDF_STORAGE_CONTRACT_INCOMPLETE' using errcode = 'P0001';
  end if;
end;
$$;

commit;
