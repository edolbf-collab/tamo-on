-- Administrative read model. Uses existing financial calculations; never moves money.
create view tamoon_admin.finance as
select r.id::text id,r.public_code title,concat_ws(' · ',p.trade_name,u.display_name) subtitle,
 case when r.status='confirmed' and r.gross_value>0 and r.voucher_discount>=r.gross_value
   and (f->>'final_due_value')::numeric=0 and (f->>'received_total')::numeric=0 then 'voucher_settled' else f->>'financial_status' end status,
 r.created_at,array[r.id,r.partner_id,r.user_id,r.monthly_cycle_id] related_ids,
 jsonb_build_object('Reserva ID',r.id,'Parceiro',p.trade_name,'Responsável',u.display_name,
 'Valor contratado',f->'contracted_value','Valor final devido',f->'final_due_value','Valor recebido',f->'received_total',
 'Valor recebido após devoluções',f->'received_net','Valor liquidado',f->'liquidated_value','Valor ainda não liquidado',f->'unliquidated_value',
 'Valor a receber',f->'balance_pending','Valor devolvido',f->'refund_completed','Valor de devolução pendente',f->'refund_pending',
 'Valor excedente em conferência',f->'blocked_excess','Valor em revisão',f->'blocked_review','Valor aguardando resolução',f->'blocked_resolution',
 'Valor aguardando crédito Asaas',f->'asaas_awaiting_credit','Tarifa Asaas registrada',f->'asaas_fee_total','Tarifa estimada incluída',f->'asaas_fee_estimated',
 'Comissão (%)',f->'commission_rate','Valor de comissão reconhecida',f->'commission_total','Valor de comissão provisória',f->'commission_provisional',
 'Financeiro encerrado',f->'financial_closed','Primeiro serviço liquidado',f->'first_service_at',
 'Pedidos de devolução a conferir',(select count(*) from private.asaas_refund_requests q where q.reservation_id=r.id and q.is_current and q.status in ('unknown','rejected')),
 'Atualizado em',r.updated_at) details,
 (f->>'financial_status' in ('refund_pending','resolution_pending','excess_received','payment_review') or exists(select 1 from private.asaas_refund_requests q where q.reservation_id=r.id and q.is_current and q.status in ('unknown','rejected'))) attention
from public.reservations r left join public.partners p on p.id=r.partner_id left join public.profiles u on u.id=r.user_id
cross join lateral(select private.reservation_financial_snapshot(r.id) f offset 0) s;
revoke all on tamoon_admin.finance from public,anon,authenticated;
create view tamoon_admin.financial_alerts as select id,title,subtitle,status,created_at,related_ids,details from tamoon_admin.finance where attention;
revoke all on tamoon_admin.financial_alerts from public,anon,authenticated;

create view tamoon_admin.charges as
select x.id::text id,coalesce(r.public_code,'Cobrança sem reserva') title,concat_ws(' · ',p.trade_name,u.display_name) subtitle,x.status::text status,x.created_at,
 array[x.reservation_id,r.partner_id,r.user_id,x.monthly_payment_stage_id,r.monthly_cycle_id] related_ids,
 jsonb_build_object('Reserva ID',x.reservation_id,'Meio',x.method,'Provedor',x.provider,'Valor cobrado',x.amount,'Moeda',x.currency,
 'Referência de pagamento no provedor',x.provider_payment_id,'Confirmada em',x.confirmed_at,'Atualizada em',x.updated_at,
 'Etapa mensal ID',x.monthly_payment_stage_id) details
from public.payment_intents x left join public.reservations r on r.id=x.reservation_id left join public.partners p on p.id=r.partner_id left join public.profiles u on u.id=r.user_id;
revoke all on tamoon_admin.charges from public,anon,authenticated;
create view tamoon_admin.quotas as
select x.id::text id,coalesce(u.display_name,'Conta removida') title,r.public_code subtitle,x.status::text status,x.created_at,
 array[x.reservation_id,r.partner_id,x.profile_id,x.monthly_payment_stage_id,r.monthly_cycle_id] related_ids,
 jsonb_build_object('Reserva ID',x.reservation_id,'Papel no pagamento',x.payment_role,'Valor devido',x.amount_due,'Valor pago',x.amount_paid,
 'Meio de baixa manual',x.manual_settlement_method,'Baixa manual por',a.display_name,'Baixa manual em',x.manual_settled_at,'Etapa mensal ID',x.monthly_payment_stage_id,'Atualizado em',x.updated_at) details
from public.reservation_participants x join public.reservations r on r.id=x.reservation_id left join public.profiles u on u.id=x.profile_id left join public.profiles a on a.id=x.manual_settled_by;
revoke all on tamoon_admin.quotas from public,anon,authenticated;
create view tamoon_admin.stages as
select x.id::text id,r.public_code title,x.stage subtitle,x.status,x.due_at created_at,array[x.reservation_id,r.partner_id,x.monthly_cycle_id] related_ids,
 jsonb_build_object('Reserva ID',x.reservation_id,'Etapa',x.stage,'Valor necessário',x.amount_required,'Valor pago',x.amount_paid,
 'Disponível desde',x.available_from,'Vencimento',x.due_at,'Pago em',x.paid_at,'Criado em',x.created_at) details
from public.monthly_payment_stages x join public.reservations r on r.id=x.reservation_id;
revoke all on tamoon_admin.stages from public,anon,authenticated;
create view tamoon_admin.occurrences as
select x.id::text id,r.public_code title,concat_ws(' · ',p.trade_name,v.name) subtitle,x.status::text status,x.starts_at created_at,
 array[x.reservation_id,r.partner_id,r.monthly_cycle_id,x.schedule_slot_id] related_ids,
 jsonb_build_object('Reserva ID',x.reservation_id,'Quadra',v.name,'Início',x.starts_at,'Fim',x.ends_at,'Valor alocado',x.allocated_value,'Horário ID',x.schedule_slot_id,'Origem da remarcação ID',x.rescheduled_from_occurrence_id,'Criado em',x.created_at) details
from public.reservation_occurrences x join public.reservations r on r.id=x.reservation_id left join public.partners p on p.id=r.partner_id left join public.venue_spaces v on v.id=r.venue_space_id;
revoke all on tamoon_admin.occurrences from public,anon,authenticated;
create view tamoon_admin.movements as
select x.id::text id,coalesce(r.public_code,'Movimento sem reserva') title,p.trade_name subtitle,x.kind status,x.occurred_at created_at,
 array[x.reservation_id,x.partner_id,x.source_id] related_ids,
 jsonb_build_object('Reserva ID',x.reservation_id,'Tipo',x.kind,'Canal',x.channel,'Valor do movimento',x.amount,
 'Fonte da evidência',x.evidence_source,'Precisão da data',x.date_quality,'Ocorrido em',x.occurred_at,'Registrado em',x.created_at,'Origem',x.source_type,'Origem ID',x.source_id) details
from private.financial_movements x left join public.reservations r on r.id=x.reservation_id left join public.partners p on p.id=x.partner_id;
revoke all on tamoon_admin.movements from public,anon,authenticated;
create view tamoon_admin.refund_requests as
select q.id::text id,r.public_code title,coalesce(u.display_name,'Conta removida') subtitle,q.status,q.created_at,array[q.reservation_id,r.partner_id,q.payment_id] related_ids,
 jsonb_build_object('Reserva ID',q.reservation_id,'Pagamento ID',q.payment_id,'Valor solicitado',q.amount,'Tentativas',q.attempts,
 'Pedido atual',q.is_current,'Pedido anterior ID',q.previous_request_id,'Transferência',q.transfer_status,'Pix',q.pix_status,
 'Falha registrada',q.error_code is not null,'Atualizado em',q.updated_at) details
from private.asaas_refund_requests q join public.reservations r on r.id=q.reservation_id left join public.profiles u on u.id=q.requested_by;
revoke all on tamoon_admin.refund_requests from public,anon,authenticated;
create view tamoon_admin.credits as
select x.id::text id,coalesce(r.public_code,'Crédito sem reserva') title,p.trade_name subtitle,'confirmed'::text status,x.confirmed_at created_at,
 array[x.reservation_id,x.partner_id] related_ids,
 jsonb_build_object('Reserva ID',x.reservation_id,'Valor creditado ao parceiro',x.partner_amount,'Valor de comissão liquidada',x.commission_amount,
 'Confirmado em',x.confirmed_at,'Fonte','Liquidação registrada pelo provedor','Referência do evento',x.provider_event_id) details
from public.financial_provider_settlements x left join public.reservations r on r.id=x.reservation_id left join public.partners p on p.id=x.partner_id
union all
select 'split:'||x.id::text,r.public_code,p.trade_name,'confirmed',x.paid_at,array[x.reservation_id,r.partner_id,x.id],
 jsonb_build_object('Reserva ID',x.reservation_id,'Pagamento ID',x.id,
 'Valor creditado ao parceiro',greatest(x.amount-x.refunded_amount-x.fee_amount-greatest(coalesce((x.metadata#>>'{asaas_split,commission_amount}')::numeric,0)-coalesce((x.metadata#>>'{asaas_split,refunded_amount}')::numeric,0),0),0),
 'Valor de comissão liquidada',greatest(coalesce((x.metadata#>>'{asaas_split,commission_amount}')::numeric,0)-coalesce((x.metadata#>>'{asaas_split,refunded_amount}')::numeric,0),0),
 'Fonte','Split confirmado e crédito recebido na subconta','Data do pagamento',x.paid_at,'Data exata do crédito','Consultar movimentos e provedor')
from public.payments x join public.reservations r on r.id=x.reservation_id left join public.partners p on p.id=r.partner_id
where x.provider='asaas' and x.status in ('confirmed','partially_refunded','refunded') and x.cash_availability='received'
 and x.metadata#>>'{asaas_route,issuer_account_id}' is not null and x.metadata#>>'{asaas_split,status}' in ('DONE','REFUNDED','NOT_REQUIRED');
revoke all on tamoon_admin.credits from public,anon,authenticated;

create view tamoon_admin.vouchers as
select x.id::text id,x.code::text title,concat_ws(' · ',x.partner_name,x.owner_name) subtitle,x.effective_status status,x.created_at,
 array[x.source_reservation_id,x.partner_id,x.owner_user_id] related_ids,
 jsonb_build_object('Reserva ID',x.source_reservation_id,'Título',x.title,'Origem',x.origin,'Tipo de desconto',x.discount_type,case when x.discount_type::text='percentage' then 'Desconto (%)' else 'Valor de desconto' end,x.discount_value,
 'Validade efetiva',x.effective_expires_at,'Validade original',x.expires_at,'Utilizações',x.used_count,'Utilizações reservadas',x.reserved_count,'Prorrogações',x.extension_count,'Último uso',x.last_used_at) details
from public.marketplace_voucher_effective_state x;
revoke all on tamoon_admin.vouchers from public,anon,authenticated;
create view tamoon_admin.webhooks as
select x.id::text id,x.event_type title,x.provider::text subtitle,x.status::text status,x.received_at created_at,
 coalesce(links.ids,array[]::uuid[]) related_ids,
 jsonb_build_object('Referência do evento',x.provider_event_id,'Recebido em',x.received_at,'Processado em',x.processed_at,'Tentativas',x.attempts,
 'Falha registrada',x.last_error is not null,'Vínculos encontrados',coalesce(cardinality(links.ids),0),
 'Conferência necessária',x.status::text in ('failed','pending','processing') or coalesce(x.processing_reason='refund_denial_unmatched',false),'Reserva ID',case when cardinality(links.ids)=1 then links.ids[1] else null end) details
from public.webhook_events x left join lateral (
 select array_agg(distinct z.reservation_id) ids from (
 select i.reservation_id from public.payment_intents i where i.provider=x.provider and i.provider_payment_id=x.payload#>>'{payment,id}'
 union select p.reservation_id from public.payments p where p.provider=x.provider and p.provider_transaction_id=x.payload#>>'{payment,id}'
 union select q.reservation_id from private.asaas_refund_requests q where x.provider::text='asaas' and q.provider_transfer_id=x.payload#>>'{transfer,id}'
 ) z where z.reservation_id is not null
) links on true;
revoke all on tamoon_admin.webhooks from public,anon,authenticated;
create view tamoon_admin.integrations as
select p.id::text id,p.trade_name title,'Asaas'::text subtitle,coalesce(x.asaas_status::text,'not_configured') status,p.created_at,array[p.id] related_ids,
 jsonb_build_object('Subconta vinculada',nullif(x.asaas_subaccount_id,'') is not null,'Carteira vinculada',nullif(x.asaas_wallet_id,'') is not null,
 'Cartão habilitado',coalesce(x.card_enabled,false),'Pix habilitado',coalesce(x.pix_direct_enabled,false),'Contingência manual Pix',coalesce(x.manual_pix_fallback,false),'Atualizada em',x.updated_at) details
from public.partners p left join public.partner_payment_configs x on x.partner_id=p.id;
revoke all on tamoon_admin.integrations from public,anon,authenticated;
create view tamoon_admin.settings as
select 'marketplace'::text id,'Configurações oficiais'::text title,'Valores efetivos no banco de dados'::text subtitle,
 case when s.real_money_enabled then 'real_money' else 'simulation' end status,s.updated_at created_at,array[]::uuid[] related_ids,
 jsonb_build_object('Marketplace habilitado',s.marketplace_enabled,'Dinheiro real habilitado',s.real_money_enabled,
 'Novos cadastros de parceiros',s.new_partner_applications_enabled,'Aprovação automática de parceiros',s.automatic_partner_approval,
 'Vouchers habilitados',s.vouchers_enabled,'E-mails automáticos',s.notification_emails,'Comissão padrão (%)',s.default_commission_rate,
 'Tarifa fixa Pix de referência',s.asaas_pix_fixed_fee,'Tarifa fixa cartão de referência',s.asaas_card_fixed_fee,'Tarifa cartão de referência (%)',s.asaas_card_percentage_fee,
 'Validade padrão voucher (dias)',s.voucher_validity_days,'Atualizada por',u.display_name,'Atualizada em',s.updated_at) details
from public.marketplace_settings s left join public.profiles u on u.id=s.updated_by where s.id;
revoke all on tamoon_admin.settings from public,anon,authenticated;

create or replace view tamoon_admin.payments as select x.id::text id,coalesce(r.public_code,'Pagamento sem reserva') title,p.trade_name subtitle,x.status::text status,x.created_at,array[x.reservation_id,r.partner_id,r.user_id] related_ids,jsonb_build_object('Reserva ID',x.reservation_id,'Fonte da tarifa',x.fee_source,'Reserva',r.public_code,'Provedor',x.provider,'Canal',x.payment_channel,'Valor',x.amount,'Taxa',x.fee_amount,'Líquido',x.net_amount,'Devolvido',x.refunded_amount,'Pago em',x.paid_at,'Disponibilidade',x.cash_availability,'Referência do provedor',x.provider_transaction_id) details from public.payments x left join public.reservations r on r.id=x.reservation_id left join public.partners p on p.id=r.partner_id;
revoke all on tamoon_admin.payments from public,anon,authenticated;

-- Extend the same guarded, paginated read API. Existing grants remain unchanged.
create or replace function tamoon_admin.directory(p_section text,p_search text,p_status text,p_from timestamptz,p_to timestamptz,p_scope uuid,p_page integer,p_size integer,p_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_total bigint;v_rows jsonb;v_statuses jsonb;v_sql text;
begin
 if auth.uid() is null or not (exists(select 1 from public.platform_admins a join public.profiles p on p.id=a.profile_id join auth.users u on u.id=p.id where a.profile_id=auth.uid() and p.status::text='active')) then raise sqlstate '42501' using message='Acesso restrito à administração.';end if;
 if p_section is null or p_section not in ('partners','reservations','payments','monthly','cycles','audit','finance','financial_alerts','charges','quotas','stages','occurrences','movements','refund_requests','credits','vouchers','webhooks','integrations','settings') then raise exception 'INVALID_SECTION';end if;
 if p_page is null or p_page<1 or p_size is null or p_size<1 or p_size>50 or char_length(coalesce(p_search,''))>120 or (p_from is not null and p_to is not null and p_to<=p_from) then raise exception 'INVALID_FILTERS';end if;
 -- Whitelist and identifier quoting; search terms remain bound literal values.
 v_sql:=format(' from tamoon_admin.%I where ($1='''' or strpos(lower(coalesce(title,'''')||'' ''||coalesce(subtitle,'''')||'' ''||id||'' ''||details::text),lower($1))>0) and ($2 is null or status=$2) and ($3 is null or created_at>=$3) and ($4 is null or created_at<$4) and ($5 is null or $5=any(related_ids)) and ($6 is null or id=$6)',p_section);
 execute 'select count(*)'||v_sql into v_total using coalesce(p_search,''),p_status,p_from,p_to,p_scope,p_id;
 execute 'select coalesce(jsonb_agg(row_data),''[]''::jsonb) from (select jsonb_build_object(''id'',id,''title'',title,''subtitle'',subtitle,''status'',status,''created_at'',created_at,''details'',details) row_data'||v_sql||' order by created_at desc nulls last,id limit $7 offset $8) q' into v_rows using coalesce(p_search,''),p_status,p_from,p_to,p_scope,p_id,p_size,(p_page::bigint-1)*p_size;
 execute 'select coalesce(jsonb_object_agg(status,n),''{}''::jsonb) from (select coalesce(status,''unknown'') status,count(*) n'||v_sql||' group by status) q' into v_statuses using coalesce(p_search,''),null::text,p_from,p_to,p_scope,p_id;
 return jsonb_build_object('items',v_rows,'total',v_total,'statuses',v_statuses,'page',p_page,'size',p_size,'checked_at',now());
end $$;
