(() => {
  "use strict";

  const cfg = window.TAMO_ON_MARKETPLACE_BACKEND_CONFIG || {};
  const listeners = new Set();
  const realtimeChannels = new Map();
  let client = null;
  const photoUrls = new Map();
  let session = null;
  let bootstrapCache = null;
  let lastCompleteBootstrap = null;
  let lastCompleteBootstrapAt = 0;
  let initialized = false;
  let readonlyState = {active:false,available:false};
  let contextVersion = 0;
  let teamAccessAttempt = {identity:"",at:0};

  const coreRealtimeTables = [
    "profiles", "partner_applications", "partner_onboarding_acceptances", "partner_registration_details", "partner_terms_releases", "partner_terms_acceptances", "partner_contract_deliveries", "partners", "partner_members", "partner_clients", "partner_documents", "venues", "venue_spaces", "venue_photos",
    "schedule_slots", "reservations", "reservation_occurrences", "reservation_participants",
    "payment_intents", "payments", "pix_installments", "vouchers", "voucher_usages",
    "cancellation_requests", "accounting_ledger",
    "reservation_chats", "chat_messages", "chat_reads", "notifications", "marketplace_events",
    "monthly_customer_links", "monthly_cycles", "monthly_pre_reservation_slots", "monthly_payment_stages", "monthly_cycle_events",
    "monthly_link_requests", "monthly_link_request_messages", "occurrence_transfer_requests", "occurrence_transfer_messages"
  ];

  function statusPayload(extra = {}) {
    return {
      enabled: Boolean(cfg.enabled),
      initialized,
      connected: Boolean(client && session?.user),
      user: session?.user || null,
      environment: cfg.environment || "staging",
      realtimeChannels: realtimeChannels.size,
      ...extra
    };
  }

  function emit(type, detail = {}) {
    const payload = { type, ...statusPayload(detail) };
    listeners.forEach((fn) => {
      try { fn(payload); } catch (error) { console.warn("MarketplaceBackend listener", error); }
    });
    window.dispatchEvent(new CustomEvent("tamo-on-marketplace-backend", { detail: payload }));
  }

  function requireClient() {
    if (!client) throw new Error("BACKEND_NOT_INITIALIZED");
    return client;
  }

  function requireConfigured() {
    if (!cfg.enabled) throw new Error("BACKEND_DISABLED");
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) throw new Error("BACKEND_CONFIG_INCOMPLETE");
    if (!window.supabase?.createClient) throw new Error("SUPABASE_JS_NOT_LOADED");
  }

  async function init() {
    if (initialized) return statusPayload();
    initialized = true;
    if (!cfg.enabled) {
      emit("disabled");
      return statusPayload();
    }
    try {
      requireConfigured();
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "tamoon-marketplace-pilot-session" },
        realtime: { params: { eventsPerSecond: 10 } }
      });
      const pilotSession = window.TamoonMarketplacePilot?.takeSession();
      if (!pilotSession) throw new Error("PILOT_SESSION_REQUIRED");
      const { data, error } = await client.auth.setSession(pilotSession);
      if (error) throw error;
      session = data.session || null;
      client.auth.onAuthStateChange(async (event, nextSession) => {
        if (session?.user?.id !== nextSession?.user?.id) unsubscribeRealtime();
        if (session?.user?.id !== nextSession?.user?.id) { readonlyState={active:false,available:false}; contextVersion++;lastCompleteBootstrap=null; }
        session = nextSession || null;
        bootstrapCache = null;
        emit("auth", { authEvent: event });
        if (!session) {
          unsubscribeRealtime();
          window.TamoonMarketplacePilot?.fail("Sua sessão de testes terminou. Volte à Comunidade para entrar novamente.");
        }
      });
      emit("ready");
      return statusPayload();
    } catch (error) {
      emit("error", { error: String(error?.message || error) });
      throw error;
    }
  }

  function onStatus(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  async function signInWithPassword(email, password) {
    throw new Error("USE_COMMUNITY_LOGIN");
    const c = requireClient();
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    session = data.session;
    emit("signed_in");
    return data;
  }

  async function signInWithGoogle(redirectTo = window.location.href) {
    throw new Error("USE_COMMUNITY_LOGIN");
    const c = requireClient();
    const { data, error } = await c.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const c = requireClient();
    await endPartnerReadonly();
    const { error } = await c.auth.signOut();
    if (error) throw error;
    session = null;
    bootstrapCache = null;
    unsubscribeRealtime();
    emit("signed_out");
    window.TamoonMarketplacePilot?.leave();
  }

  const readonlyRpcNames = new Set(["marketplace_financial_period","marketplace_financial_receipts","reservation_payment_audit","partner_readonly_status","partner_readonly_bootstrap","monthly_link_request_messages","occurrence_transfer_available_slots","occurrence_transfer_conversation","community_marketplace_notifications","admin_search_reservations","reservation_cancellation_preview"]);

  async function assertWritable() {
    const c=requireClient();
    const {data,error}=await c.rpc("assert_marketplace_writable");
    if(error) throw error;
    if(data!==true) throw new Error("PARTNER_PREVIEW_READ_ONLY");
  }

  async function beginPartnerReadonly(partnerId) {
    contextVersion++;lastCompleteBootstrap=null;
    const {data,error}=await requireClient().rpc("begin_partner_readonly",{p_partner_id:partnerId});
    if(error) throw error;
    readonlyState=data;bootstrapCache=null;
    return data;
  }

  async function endPartnerReadonly() {
    contextVersion++;lastCompleteBootstrap=null;
    const {data,error}=await requireClient().rpc("end_partner_readonly");
    if(error) throw error;
    readonlyState=data;bootstrapCache=null;
    return data;
  }

  async function invoke(name, body = {}) {
    if (!["backend-health","marketplace-bootstrap"].includes(name)) await assertWritable();
    const c = requireClient();
    const { data, error } = await c.functions.invoke(name, { body });
    if (error) {
      let payload;
      try { payload = await error.context?.json?.(); } catch (_) { /* Preserve the original HTTP error for non-JSON responses. */ }
      if (typeof payload?.error === "string") {
        const detailError = new Error(payload.error);
        if (/^(ASAAS_|CHECKOUT_)/.test(payload.error) && payload.diagnostic && typeof payload.diagnostic === "object") {
          detailError.paymentDiagnostic = payload.diagnostic;
        }
        if (/^(ASAAS_|CHECKOUT_)/.test(payload.error) && payload.retryAllowed === true
            && typeof payload.retryToken === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload.retryToken)) {
          detailError.paymentRetryToken = payload.retryToken;
        }
        throw detailError;
      }
      throw error;
    }
    return data;
  }

  async function rpc(name, args = {}) {
    if (!readonlyRpcNames.has(name)) await assertWritable();
    const c = requireClient();
    const { data, error } = await c.rpc(name, args);
    if (error) throw error;
    return data;
  }

  async function bootstrap({ force = false, changes = [], onCore } = {}) {
    const requestedIdentity = session?.user?.id;
    const requestedContext = contextVersion;
    if (!requestedIdentity) throw new Error("AUTH_REQUIRED");
    const c = requireClient();
    const {data:previewStatus,error:previewError}=await c.rpc("partner_readonly_status");
    if(previewError) throw previewError;
    if(requestedIdentity!==session?.user?.id)throw new Error("AUTH_IDENTITY_CHANGED");
    if(requestedContext!==contextVersion) throw new Error("PREVIEW_CONTEXT_CHANGED");
    readonlyState=previewStatus;
    if(readonlyState.active){
      const {data:snapshot,error}=await c.rpc("partner_readonly_bootstrap");
      if(error)throw error;
      if(requestedContext!==contextVersion || requestedIdentity!==session?.user?.id || snapshot?.profile?.id!==requestedIdentity)throw new Error("PREVIEW_CONTEXT_CHANGED");
      const {data:clients,error:clientsError}=await c.rpc("partner_client_directory",{p_partner_id:snapshot.preview.partner_id});
      if(clientsError)throw clientsError;
      if(requestedContext!==contextVersion || requestedIdentity!==session?.user?.id)throw new Error("PREVIEW_CONTEXT_CHANGED");
      snapshot.partner_clients=clients||[];snapshot.agenda_initial_slots=[];
      await warmPhotoUrls(snapshot);
      bootstrapCache=snapshot;emit("bootstrap",{bootstrap:snapshot});return snapshot;
    }
    if (!force && !bootstrapCache?.preview?.active && bootstrapCache?.profile?.id === requestedIdentity) return bootstrapCache;
    const {data:pendingTeamAccess,error:pendingTeamError}=await c.rpc("pending_community_team_access");
    if(pendingTeamError) throw pendingTeamError;
    if((pendingTeamAccess||[]).length && (teamAccessAttempt.identity!==requestedIdentity || Date.now()-teamAccessAttempt.at>30000)){
      teamAccessAttempt={identity:requestedIdentity,at:Date.now()};
      if(session?.user?.id!==requestedIdentity || contextVersion!==requestedContext) throw new Error("AUTH_IDENTITY_CHANGED");
      try { await invoke("partner-team-community",{action:"claim"}); }
      catch(_error){ emit("team_access_pending"); }
    }
    if(session?.user?.id!==requestedIdentity || contextVersion!==requestedContext) throw new Error("AUTH_IDENTITY_CHANGED");
    const { data, error } = await c.rpc("marketplace_bootstrap");
    if (error) throw error;
    const snapshot = data || {};
    if(snapshot.profile?.status === "blocked"){
      if(requestedContext!==contextVersion||session?.user?.id!==requestedIdentity||snapshot.profile.id!==requestedIdentity)throw new Error("AUTH_IDENTITY_CHANGED");
      bootstrapCache=snapshot;emit("bootstrap",{bootstrap:snapshot});return snapshot;
    }
    if(requestedContext!==contextVersion || session?.user?.id!==requestedIdentity || snapshot.profile?.id!==requestedIdentity)throw new Error("AUTH_IDENTITY_CHANGED");
    // Discovery needs the verified catalog, not financial/admin directories.
    onCore?.(snapshot);
    const photosReady=warmPhotoUrls(snapshot).then(()=>null,error=>error);
    // Notification/chat-only events can reuse extra directories only when every other
    // core field (including financial rows and permissions) is identical to the last full read.
    const coreKeys=Object.keys(snapshot).filter(key=>!["generated_at","notifications","chats","chat_effective_state","chat_messages","chat_unread"].includes(key));
    const canReuse=Date.now()-lastCompleteBootstrapAt<30000 && changes.length>0 && changes.every(table=>["notifications","chat_messages","chat_reads","reservation_chats"].includes(table))
      && lastCompleteBootstrap?.profile?.id===requestedIdentity && !lastCompleteBootstrap.preview?.active
      && coreKeys.every(key=>JSON.stringify(snapshot[key])===JSON.stringify(lastCompleteBootstrap[key]));
    if(canReuse){
      if(requestedContext!==contextVersion || session?.user?.id!==requestedIdentity || snapshot.profile?.id!==requestedIdentity)throw new Error("AUTH_IDENTITY_CHANGED");
      const photoError=await photosReady;if(photoError)throw photoError;
      if(requestedContext!==contextVersion || session?.user?.id!==requestedIdentity)throw new Error("AUTH_IDENTITY_CHANGED");
      const merged={...lastCompleteBootstrap,...snapshot};
      bootstrapCache=merged;emit("bootstrap",{bootstrap:merged});return merged;
    }
    const { error: voucherRefreshError } = await c.rpc("refresh_marketplace_vouchers");
    if (voucherRefreshError) throw voucherRefreshError;
    const [voucherStateResult, cancellationResult, ledgerResult, financialReconciliationResult, paymentResponsibleDirectoryResult, partnerDocumentsResult, partnerTeamResult, communityNotificationsResult,
      monthlyLinksResult, monthlyLinkDirectoryResult, monthlySplitDirectoryResult, monthlyCyclesResult, monthlyPreReservationsResult, monthlyStagesResult, monthlyEventsResult, monthlyRequestsResult, occurrenceTransfersResult, reservationFinancialStatusResult, partnerOnboardingResult, partnerClientsResult,
      scheduleDetailsResult, adminUsersResult, adminReservationsResult, initialSlotFlagsResult] = await Promise.all([
      c.from("marketplace_voucher_effective_state").select("*").order("created_at", { ascending: false }),
      c.from("cancellation_requests").select("*").order("created_at", { ascending: false }),
      c.from("accounting_ledger").select("*").order("created_at", { ascending: false }),
      c.rpc("marketplace_financial_reconciliation"),
      c.rpc("reservation_payment_responsible_directory"),
      c.from("partner_documents").select("*").order("created_at", { ascending: false }),
      c.rpc("partner_team_directory", { p_partner_id:null }),
      c.rpc("community_marketplace_notifications", { p_group_id:null }),
      c.from("monthly_customer_links").select("id,partner_id,venue_id,venue_space_id,group_id,customer_profile_id,weekday,start_time,end_time,monthly_price,initial_guarantee_percent,start_month,end_month,origin,status,accepted_at,require_renewal_confirmation,suspension_reason").order("start_month", { ascending:false }),
      c.rpc("monthly_customer_link_directory"),
      c.rpc("monthly_reservation_split_directory"),
      c.from("monthly_cycles").select("id,monthly_link_id,service_month,status,reservation_id,payment_available_at,first_occurrence_at,initial_due_at,balance_due_at,monthly_total,initial_required,balance_required,initial_paid,balance_paid,collection_mode,guarantee_required,guarantee_paid,total_paid,guarantee_reached_at,occurrence_count,renewal_confirmed_at").order("service_month", { ascending:false }),
      c.from("monthly_pre_reservation_slots").select("id,monthly_cycle_id,schedule_slot_id,status").order("id", { ascending:false }),
      c.from("monthly_payment_stages").select("id,monthly_cycle_id,reservation_id,stage,status,available_from,due_at,amount_required,amount_paid").order("due_at", { ascending:true }),
      c.from("monthly_cycle_events").select("monthly_cycle_id,reservation_occurrence_id,marketplace_event_id,financial_status"),
      c.rpc("monthly_link_request_directory"),
      c.rpc("occurrence_transfer_directory_v2"),
      c.rpc("reservation_financial_status_directory"),
      c.rpc("partner_onboarding_directory"),
      c.rpc("partner_client_directory",{p_partner_id:null}),
      snapshot.partner_memberships?.length ? c.from("schedule_slots").select("id,venue_space_id,series_id,monthly_link_key,starts_at,ends_at,status,blocked_reason,blocked_at") : Promise.resolve({data:[]}),
      snapshot.is_admin===true ? c.rpc("admin_marketplace_users") : Promise.resolve({data:[]}),
      snapshot.is_admin===true ? c.rpc("admin_search_reservations",{p_partner_id:null,p_user_id:null,p_date:null,p_status:null}) : Promise.resolve({data:[]}),
      c.rpc("agenda_initial_slot_flags",{})
    ]);
    if (voucherStateResult.error) throw voucherStateResult.error;
    if (cancellationResult.error) throw cancellationResult.error;
    if (ledgerResult.error) throw ledgerResult.error;
    if (financialReconciliationResult.error) throw financialReconciliationResult.error;
    if (paymentResponsibleDirectoryResult.error) throw paymentResponsibleDirectoryResult.error;
    if (partnerDocumentsResult.error) throw partnerDocumentsResult.error;
    if (partnerTeamResult.error) throw partnerTeamResult.error;
    if (communityNotificationsResult.error) throw communityNotificationsResult.error;
    if (monthlyLinksResult.error) throw monthlyLinksResult.error;
    if (monthlyLinkDirectoryResult.error) throw monthlyLinkDirectoryResult.error;
    if (monthlySplitDirectoryResult.error) throw monthlySplitDirectoryResult.error;
    if (monthlyCyclesResult.error) throw monthlyCyclesResult.error;
    if (monthlyPreReservationsResult.error) throw monthlyPreReservationsResult.error;
    if (monthlyStagesResult.error) throw monthlyStagesResult.error;
    if (monthlyEventsResult.error) throw monthlyEventsResult.error;
    if (monthlyRequestsResult.error) throw monthlyRequestsResult.error;
    if (occurrenceTransfersResult.error) throw occurrenceTransfersResult.error;
    if (reservationFinancialStatusResult.error) throw reservationFinancialStatusResult.error;
    snapshot.voucher_effective_state = voucherStateResult.data || [];
    snapshot.cancellation_requests = cancellationResult.data || [];
    snapshot.accounting_ledger = ledgerResult.data || [];
    snapshot.financial_reconciliation = financialReconciliationResult.data || [];
    snapshot.payment_responsible_directory = paymentResponsibleDirectoryResult.data || [];
    if (partnerOnboardingResult.error) throw partnerOnboardingResult.error;
    snapshot.partner_onboarding = partnerOnboardingResult.data || [];
    snapshot.partner_documents = partnerDocumentsResult.data || [];
    snapshot.partner_team_directory = partnerTeamResult.data || [];
    if (partnerClientsResult.error) throw partnerClientsResult.error;
    snapshot.partner_clients = partnerClientsResult.data || [];
    snapshot.community_marketplace_notifications = communityNotificationsResult.data || [];
    snapshot.monthly_customer_links = monthlyLinksResult.data || [];
    snapshot.monthly_customer_link_directory = monthlyLinkDirectoryResult.data || [];
    snapshot.monthly_reservation_split_directory = monthlySplitDirectoryResult.data || [];
    snapshot.monthly_cycles = monthlyCyclesResult.data || [];
    snapshot.monthly_pre_reservation_slots = monthlyPreReservationsResult.data || [];
    snapshot.monthly_payment_stages = monthlyStagesResult.data || [];
    snapshot.monthly_cycle_events = monthlyEventsResult.data || [];
    snapshot.monthly_link_requests = monthlyRequestsResult.data || [];
    snapshot.occurrence_transfer_requests = occurrenceTransfersResult.data || [];
    snapshot.reservation_financial_status = reservationFinancialStatusResult.data || [];
    for(const result of [scheduleDetailsResult,adminUsersResult,adminReservationsResult,initialSlotFlagsResult])if(result.error)throw result.error;
    snapshot.agenda_initial_slots=initialSlotFlagsResult.data||[];
    snapshot.schedule_details=scheduleDetailsResult.data||[];
    snapshot.admin_users=adminUsersResult.data||[];
    snapshot.admin_reservations=adminReservationsResult.data||[];
    if (requestedContext!==contextVersion || session?.user?.id !== requestedIdentity || snapshot.profile?.id !== requestedIdentity) throw new Error("AUTH_IDENTITY_CHANGED");
    const photoError=await photosReady;if(photoError)throw photoError;
    if(requestedContext!==contextVersion || session?.user?.id!==requestedIdentity)throw new Error("AUTH_IDENTITY_CHANGED");
    lastCompleteBootstrap = snapshot;lastCompleteBootstrapAt=Date.now();
    bootstrapCache = snapshot;
    emit("bootstrap", { bootstrap: snapshot });
    return snapshot;
  }

  function unsubscribeRealtime() {
    if (!client) return;
    for (const channel of realtimeChannels.values()) client.removeChannel(channel);
    realtimeChannels.clear();
    emit("realtime_unsubscribed");
  }

  function subscribeRealtime(onChange) {
    const c = requireClient();
    unsubscribeRealtime();
    if (!cfg.realtime) return [];
    for (const table of coreRealtimeTables) {
      const channel = c
        .channel(`marketplace:${table}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, async (payload) => {
          bootstrapCache = null;
          emit("realtime_change", { table, payload });
          if (typeof onChange === "function") await onChange({ table, payload });
        })
        .subscribe((status) => emit("realtime_status", { table, channelStatus: status }));
      realtimeChannels.set(table, channel);
    }
    return [...realtimeChannels.keys()];
  }

  async function submitPartnerApplication(input) {
    return rpc("submit_partner_application", {
      p_trade_name: input.tradeName,
      p_legal_name: input.legalName,
      p_cnpj: input.cnpj,
      p_city: input.city,
      p_spaces_count: Number(input.spacesCount || 1),
      p_space_types: input.spaceTypes || [],
      p_responsible_name: input.responsibleName,
      p_email: input.email,
      p_phone: input.phone,
      p_notes: input.notes || null,
      p_contact_consent: Boolean(input.contactConsent),
      p_secondary_email: String(input.secondaryEmail || "").trim() || null
    });
  }

  async function reviewPartnerApplication(applicationId, decision, notes = null) {
    return rpc("review_partner_application", { p_application_id: applicationId, p_decision: decision, p_notes: notes });
  }

  async function validatePartnerRegistration(partnerId, notes) {
    return rpc("admin_validate_partner_registration", {p_partner_id:partnerId,p_notes:notes});
  }

  async function sendPartnerValidationUpdate(partnerId, message) {
    return rpc("send_partner_validation_update", {p_partner_id:partnerId,p_message:message});
  }

  async function acceptPartnerOnboarding(partnerId, documents) {
    return rpc("accept_partner_onboarding", {p_partner_id:partnerId,p_contract_document_id:documents.contract.id,
      p_terms_document_id:documents.terms.id,p_privacy_document_id:documents.privacy.id,p_confirm:true});
  }

  async function adminUpdatePartner(partnerId, patch) {
    return rpc("admin_update_partner", { p_partner_id: partnerId, p_patch: patch || {} });
  }

  async function adminDeletePartner(partnerId, reason = null) {
    return rpc("admin_delete_partner", { p_partner_id: partnerId, p_reason: reason });
  }

  async function createScheduleSeries(input) {
    return rpc("create_schedule_series", {
      p_venue_space_id: input.spaceId,
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_weekdays: input.weekdays || [],
      p_opening_time: input.openingTime || null,
      p_closing_time: input.closingTime || null,
      p_slot_minutes: input.slotMinutes || null,
      p_interval_minutes: input.intervalMinutes || 0,
      p_price: Number(input.price || 0),
      p_monthly_eligible: Boolean(input.monthlyEligible),
      p_monthly_package_price: input.monthlyPackagePrice == null ? null : Number(input.monthlyPackagePrice),
      p_mode: input.mode || "grid",
      p_specific_start: input.specificStart || null,
      p_specific_end: input.specificEnd || null
    });
  }

  async function setSlotBlocked(slotId, blocked, reason = null) {
    return rpc("set_schedule_slot_blocked", { p_slot_id: slotId, p_blocked: Boolean(blocked), p_reason: reason });
  }

  async function deleteScheduleSlots(slotIds) {
    return rpc("delete_schedule_slots", { p_slot_ids: slotIds });
  }

  async function updateScheduleSlotChain(input) {
    return rpc("update_schedule_slots_selected", {
      p_slot_id: input.slotId,
      p_new_start: input.startsAt,
      p_new_end: input.endsAt,
      p_new_price: input.price == null ? null : Number(input.price),
      p_monthly_eligible: input.monthlyEligible == null ? null : Boolean(input.monthlyEligible),
      p_monthly_package_price: input.monthlyPackagePrice == null ? null : Number(input.monthlyPackagePrice),
      p_propagate_following: input.propagateFollowing !== false,
      p_additional_slot_ids: input.additionalSlotIds || []
    });
  }

  async function createReservation(input) {
    return rpc("create_reservation_with_payment", {
      p_schedule_slot_id: input.slotId,
      p_group_id: input.groupId,
      p_event_id: input.eventId || null,
      p_create_event: input.createEvent !== false,
      p_booking_mode: input.bookingMode || "single",
      p_payment_method: input.paymentMethod || "pix_direct_partner",
      p_voucher_code: input.voucherCode || null,
      p_split: input.split || [],
      p_policy_version: input.policyVersion || "marketplace-0.2.0"
    });
  }

  async function createReservationPrebooking(input) {
    return rpc("create_reservation_prebooking", {
      p_schedule_slot_id: input.slotId,
      p_group_id: input.groupId || null,
      p_event_id: input.eventId || null,
      p_create_event: input.createEvent !== false,
      p_policy_version: input.policyVersion || "marketplace-0.2.0-part-22p",
      p_policy_accepted: input.policyAccepted === true
    });
  }

  async function updateReservationPrebooking(input) {
    return rpc("update_reservation_prebooking", {
      p_reservation_id: input.reservationId,
      p_group_id: input.groupId || null,
      p_event_id: input.eventId || null,
      p_create_event: input.createEvent === true,
      p_expected_revision: input.expectedRevision
    });
  }

  async function contractDirectMonthlyOffer(input) {
    return rpc("contract_direct_monthly_offer", {
      p_schedule_slot_id: input.slotId,
      p_group_id: input.groupId,
      p_payment_method: input.paymentMethod || "pix_direct_partner",
      p_split: input.split || [],
      p_card_payer_id: input.cardPayerId || null,
      p_policy_version: input.policyVersion || "marketplace-0.2.0-part-22o",
      p_prepayment_mode: input.prepaymentMode || "staged"
    });
  }

  async function contractDirectMonthlyPrebooking(input) {
    return rpc("contract_direct_monthly_prebooking", {
      p_schedule_slot_id: input.slotId,
      p_group_id: input.groupId || null,
      p_policy_version: input.policyVersion || "marketplace-0.2.0-part-22p",
      p_policy_accepted: input.policyAccepted === true
    });
  }

  async function configureReservationPayment(input) {
    if (input.monthly) {
      return rpc("configure_monthly_single_collection", {
        p_reservation_id: input.reservationId,
        p_payment_method: input.paymentMethod,
        p_split: input.split || [],
        p_card_payer_id: input.cardPayerId || null,
        p_policy_version: input.policyVersion || "marketplace-0.2.0-part-22r",
        p_policy_accepted: input.policyAccepted === true
      });
    }
    return rpc("configure_reservation_payment", {
      p_reservation_id: input.reservationId,
      p_payment_method: input.paymentMethod,
      p_voucher_code: input.voucherCode || null,
      p_split: input.split || [],
      p_card_payer_id: input.cardPayerId || null,
      p_prepayment_mode: input.prepaymentMode || "staged",
      p_policy_version: input.policyVersion || "marketplace-0.2.0-part-22p",
      p_policy_accepted: input.policyAccepted === true,
      p_expected_prebooking_revision: input.expectedPrebookingRevision ?? 0
    });
  }

  async function activateMonthlyCycleWithPolicy(input) {
    return rpc("activate_monthly_cycle_with_policy", {
      p_monthly_cycle_id: input.monthlyCycleId,
      p_payment_method: input.paymentMethod,
      p_split: input.split || [],
      p_card_payer_id: input.cardPayerId || null,
      p_policy_version: input.policyVersion || "marketplace-0.2.0-part-22p",
      p_prepayment_mode: input.prepaymentMode || "staged",
      p_policy_accepted: input.policyAccepted === true
    });
  }

  async function activateMonthlyCyclePrebooking(input) {
    return rpc("activate_monthly_cycle_reviewed", {
      p_monthly_cycle_id: input.monthlyCycleId,
      p_expected_total: Number(input.expectedTotal),
      p_policy_version: input.policyVersion || "marketplace-0.2.0-part-22p-r5",
      p_policy_accepted: input.policyAccepted === true
    });
  }

  async function requestMonthlyCustomerLink(input) {
    return rpc("request_monthly_customer_link", {
      p_schedule_slot_id: input.slotId,
      p_group_id: input.groupId,
      p_start_month: input.startMonth || null,
      p_message: input.message || null
    });
  }

  async function monthlyLinkRequestMessages(requestId) {
    return rpc("monthly_link_request_messages", { p_request_id: requestId });
  }

  async function sendMonthlyLinkRequestMessage(requestId, body) {
    return rpc("send_monthly_link_request_message", { p_request_id: requestId, p_body: body });
  }

  async function markMonthlyLinkRequestNotificationsRead(requestId) {
    await assertWritable();
    const c = requireClient();
    const { data, error } = await c.from("notifications")
      .update({ status:"read", read_at:new Date().toISOString() })
      .eq("entity_type","monthly_link_request")
      .eq("entity_id",requestId)
      .eq("status","unread")
      .select("id");
    if (error) throw error;
    bootstrapCache = null;
    return data || [];
  }

  async function partnerProposeMonthlyLinkRequest(input) {
    return rpc("partner_propose_monthly_link_request", {
      p_request_id: input.requestId,
      p_monthly_price: Number(input.monthlyPrice),
      p_start_month: input.startMonth,
      p_require_renewal_confirmation: Boolean(input.requireRenewalConfirmation),
      p_response: input.response || null
    });
  }

  async function closeMonthlyLinkRequest(requestId, decision, reason = null) {
    return rpc("close_monthly_link_request", { p_request_id: requestId, p_decision: decision, p_reason: reason });
  }

  async function acceptMonthlyCustomerLink(monthlyLinkId) {
    return rpc("accept_monthly_customer_link", { p_monthly_link_id: monthlyLinkId });
  }

  async function confirmMonthlyCycleRenewal(monthlyCycleId) {
    return rpc("confirm_monthly_cycle_renewal", { p_monthly_cycle_id: monthlyCycleId });
  }

  async function syncMonthlyPreReservations(monthlyLinkId = null) {
    return rpc("sync_monthly_pre_reservations", { p_monthly_link_id: monthlyLinkId || null });
  }

  async function reactivateMonthlyCustomerLink(monthlyLinkId, reason = null) {
    return rpc("reactivate_monthly_customer_link", { p_monthly_link_id: monthlyLinkId, p_reason: reason });
  }

  async function activateMonthlyCycle(input) {
    return rpc("activate_monthly_cycle_with_prepayment", {
      p_monthly_cycle_id: input.monthlyCycleId,
      p_payment_method: input.paymentMethod,
      p_split: input.split || [],
      p_card_payer_id: input.cardPayerId || null,
      p_policy_version: input.policyVersion || "marketplace-0.2.0-part-22m",
      p_prepayment_mode: input.prepaymentMode || "staged"
    });
  }

  async function prepareMonthlyFullPrepayment(monthlyCycleId) {
    return rpc("prepare_monthly_full_prepayment", { p_monthly_cycle_id: monthlyCycleId });
  }

  async function partnerSettleMonthlyShare(input) {
    return rpc("partner_settle_monthly_share", {
      p_participant_id: input.participantId,
      p_method: input.method,
      p_reference: input.reference || null,
      p_notes: input.notes || null
    });
  }

  async function partnerSettleSingleReservation({reservationId,reference,notes}) {
    return rpc("partner_settle_single_reservation",{p_reservation_id:reservationId,p_reference:reference||null,p_notes:notes||null});
  }

  async function routePayment(reservationId, retryToken = null, communicationScope = null) {
    return invokeAsaas(cfg.functions?.paymentRouter || "payment-router", { reservationId, retryToken },'Preparando o pagamento com cartão…',{scope:communicationScope});
  }

  async function createPixCharges(reservationId, retryToken = null, communicationScope = null, payer = null) {
    return invokeAsaas(cfg.functions?.pixChargeRouter || "pix-charge-router", { reservationId, retryToken, ...(payer ? {payer} : {}) },'Preparando o pagamento por Pix…',{scope:communicationScope});
  }

  async function simulatePayment(reservationId, installmentId = null) {
    return invoke(cfg.functions?.paymentSimulator || "payment-simulator", { reservationId, installmentId });
  }

  async function asaasRefund(reservationId, action = 'preview', expectedRequestId = null, options = {}) {
    return invokeAsaas('asaas-refund', {reservationId, action, expectedRequestId, paymentId:options.paymentId||null, amount:options.amount??null},
      ['submit','retry'].includes(action)?'Solicitando devolução ao Asaas…':'Verificando a devolução…',options);
  }

  async function invokeAsaas(name,body,label,{background=false,scope=null}={}) {
    if(!window.MarketplaceAsaasCommunication)throw new Error('ASAAS_COMMUNICATION_UNAVAILABLE');
    return window.MarketplaceAsaasCommunication.run(label,()=>invoke(name,body),{background,scope});
  }

  async function reservationCancellationPreview(reservationId) {
    return rpc("reservation_cancellation_preview", { p_reservation_id:reservationId });
  }

  async function cancelReservation(reservationId, reason = null, consent = {}) {
    return rpc("cancel_reservation", { p_reservation_id:reservationId, p_reason:reason,
      p_policy_version:consent.policyVersion || null, p_policy_accepted:consent.accepted === true,
      p_preview_token:consent.previewToken || null });
  }

  async function requestMonthlyOccurrenceTransfer(occurrenceId, reason) {
    return rpc("request_monthly_occurrence_transfer", { p_occurrence_id:occurrenceId, p_reason:reason });
  }

  async function partnerCancelMonthlyOccurrence(occurrenceId, reason) {
    return rpc("partner_cancel_monthly_occurrence", { p_occurrence_id:occurrenceId, p_reason:reason });
  }

  async function occurrenceTransferAvailableSlots(requestId) {
    return rpc("occurrence_transfer_available_slots", { p_request_id:requestId });
  }

  async function proposeMonthlyOccurrenceTransfer(requestId, scheduleSlotId) {
    return rpc("propose_monthly_occurrence_transfer", { p_request_id:requestId, p_target_schedule_slot_id:scheduleSlotId });
  }

  async function occurrenceTransferConversation(requestId) {
    return rpc("occurrence_transfer_conversation", {p_request_id:requestId});
  }

  async function sendOccurrenceTransferMessage(requestId, body, senderSide, clientMessageId) {
    return rpc("send_occurrence_transfer_message", {p_request_id:requestId,p_body:body,p_sender_side:senderSide,p_client_message_id:clientMessageId});
  }

  async function markOccurrenceTransferConversationRead(requestId,lastMessageOrder) {
    return rpc("mark_occurrence_transfer_conversation_read", {p_request_id:requestId,p_last_message_order:lastMessageOrder});
  }

  async function acceptMonthlyOccurrenceTransfer(requestId,proposalRevision,changesAccepted) {
    return rpc("accept_monthly_occurrence_transfer", {p_request_id:requestId,p_proposal_revision:proposalRevision,p_changes_accepted:changesAccepted===true});
  }

  async function resolveMonthlyOccurrenceTransferRefund(requestId) {
    return rpc("resolve_monthly_occurrence_transfer_refund", { p_request_id:requestId });
  }

  async function declineMonthlyOccurrenceTransfer(requestId, reason = null) {
    return rpc("decline_monthly_occurrence_transfer", { p_request_id:requestId, p_reason:reason });
  }

  async function cancelMonthlyOccurrenceTransfer(requestId) {
    return rpc("cancel_monthly_occurrence_transfer", { p_request_id:requestId });
  }

  async function markReservationNotificationsRead(notificationIds) {
    const identity=session?.user?.id,requestedContext=contextVersion;
    const ids=[...new Set(notificationIds||[])].filter(Boolean);
    if(!identity||!ids.length)return [];
    await assertWritable();
    if(identity!==session?.user?.id||requestedContext!==contextVersion)throw Error("AUTH_IDENTITY_CHANGED");
    const {data,error}=await requireClient().from("notifications").update({status:"read",read_at:new Date().toISOString()})
      .eq("profile_id",identity).in("id",ids).select("id,status,read_at");
    if(error)throw error;
    if(identity!==session?.user?.id||requestedContext!==contextVersion)throw Error("AUTH_IDENTITY_CHANGED");
    bootstrapCache=null;return data||[];
  }

  async function markOccurrenceTransferNotificationsRead(requestIds) {
    await assertWritable();
    const c = requireClient();
    const ids = [...new Set((Array.isArray(requestIds) ? requestIds : [requestIds]).filter(Boolean))];
    if (!session?.user || !ids.length) return [];
    const { data, error } = await c.from("notifications")
      .update({ status:"read", read_at:new Date().toISOString() })
      .eq("profile_id", session.user.id)
      .eq("entity_type", "occurrence_transfer")
      .eq("status", "unread")
      .in("entity_id", ids)
      .select("id");
    if (error) throw error;
    bootstrapCache = null;
    return data || [];
  }

  async function createPromotionalVoucher(input) {
    return rpc("create_scheduled_promotional_voucher", {
      p_title: input.title,
      p_code: input.code,
      p_discount_type: input.discountType,
      p_discount_value: Number(input.discountValue),
      p_expires_at: input.expiresAt,
      p_partner_id: input.partnerId || null,
      p_minimum_value: Number(input.minimumValue || 0),
      p_booking_scope: input.bookingScope || "any",
      p_single_use: Boolean(input.singleUse),
      p_event_date:input.eventDate||null,
      p_event_start_time:input.eventStartTime||null,
      p_event_end_time:input.eventEndTime||null
    });
  }

  async function setMarketplaceUserStatus(profileId, status, reason) {
    return rpc("admin_set_marketplace_user_status", {p_profile_id:profileId,p_status:status,p_reason:reason});
  }

  async function deleteVoucher(voucherId) {
    return rpc("delete_voucher", { p_voucher_id: voucherId });
  }

  async function setPromotionalVoucherActive(voucherId, active) {
    return rpc("set_promotional_voucher_active", { p_voucher_id: voucherId, p_active: Boolean(active) });
  }

  async function sendChatMessage(reservationId, body) {
    return rpc("send_chat_message", { p_reservation_id: reservationId, p_body: body });
  }

  async function markChatRead(reservationId) {
    const identity=session?.user?.id,requestedContext=contextVersion;
    if(!identity)throw Error("AUTH_REQUIRED");
    await assertWritable();
    if(identity!==session?.user?.id||requestedContext!==contextVersion)throw Error("AUTH_IDENTITY_CHANGED");
    const {data,error}=await requireClient().rpc("mark_chat_read", {p_reservation_id:reservationId});
    if(error)throw error;
    if(identity!==session?.user?.id||requestedContext!==contextVersion)throw Error("AUTH_IDENTITY_CHANGED");
    bootstrapCache=null;return data;
  }

  async function communityMarketplaceNotifications(groupId = null) {
    return rpc("community_marketplace_notifications", { p_group_id:groupId || null });
  }

  async function markCommunityMarketplaceNotificationRead(notificationId) {
    return rpc("mark_community_marketplace_notification_read", { p_notification_id:notificationId });
  }

  async function uploadVenuePhoto({ venueId, partnerId, file, tone = null, luminance = null, isFavorite = false }) {
    await assertPartnerResource("venue",venueId);
    const c = requireClient();
    if (!session?.user) throw new Error("UNAUTHORIZED");
    const safeName = String(file.name || "foto.jpg").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const storagePath = `${partnerId}/${venueId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await c.storage.from("marketplace-venue-photos").upload(storagePath, file, { upsert: false });
    if (uploadError) throw uploadError;
    const { data: row, error: insertError } = await c.from("venue_photos").insert({
      venue_id: venueId,
      uploaded_by: session.user.id,
      storage_path: storagePath,
      display_name: file.name || null,
      tone,
      luminance,
      is_favorite: false
    }).select().single();
    if (insertError) {
      await c.storage.from("marketplace-venue-photos").remove([storagePath]);
      throw insertError;
    }
    if (isFavorite) await rpc("set_favorite_venue_photo", { p_photo_id: row.id });
    bootstrapCache = null;
    return row;
  }

  async function deleteVenuePhoto(photo) {
    await assertPartnerResource("photo",photo.id);
    const c = requireClient();
    const { error: dbError } = await c.from("venue_photos").delete().eq("id", photo.id).select("id").single();
    if (dbError) throw dbError;
    const { error: storageError } = await c.storage.from("marketplace-venue-photos").remove([photo.storage_path]);
    if (storageError) console.warn("Foto removida do banco, mas Storage retornou erro", storageError);
    bootstrapCache = null;
  }

  async function setFavoriteVenuePhoto(photoId) {
    await assertPartnerResource("photo",photoId);
    return rpc("set_favorite_venue_photo", { p_photo_id: photoId });
  }

  async function registrationAction(partnerId, action, data) {
    return rpc("partner_registration_action", {p_partner_id:partnerId,p_action:action,p_data:data});
  }

  async function publishPartnerTerms(partnerId, terms, privacy) {
    for (const file of [terms,privacy]) {
      if (!file || file.type!=="application/pdf" || !file.size || file.size>15728640) throw new Error("Selecione os dois PDFs de até 15 MB.");
    }
    const first=await uploadPartnerDocument({partnerId,documentType:"Termos de uso",file:terms});
    const second=await uploadPartnerDocument({partnerId,documentType:"Política de privacidade",file:privacy});
    // Somente esta transacao publica o par. Falhas anteriores deixam rascunhos, sem aceite disponível.
    return registrationAction(partnerId,"publish_terms",{terms_id:first.id,privacy_id:second.id});
  }

  async function uploadPartnerDocument({ partnerId, documentType, file }) {
    await assertPartnerResource("document_parent",partnerId);
    const c = requireClient();
    if (!session?.user) throw new Error("UNAUTHORIZED");
    if (!partnerId || !documentType || !file) throw new Error("DOCUMENT_INPUT_INCOMPLETE");
    if (!['application/pdf','image/jpeg','image/png'].includes(file.type)) throw new Error("DOCUMENT_FORMAT_NOT_SUPPORTED");
    if (!file.size || file.size > 15728640) throw new Error("DOCUMENT_SIZE_NOT_SUPPORTED");
    const documentId = crypto.randomUUID();
    const safeName = String(file.name || "documento").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const storagePath = `${partnerId}/${documentId}/${safeName}`;
    const { error: uploadError } = await c.storage.from("marketplace-partner-documents").upload(storagePath, file, { upsert:false });
    if (uploadError) throw uploadError;
    const { data: row, error: insertError } = await c.from("partner_documents").insert({
      id:documentId,
      partner_id:partnerId,
      document_type:documentType,
      status:"Pendente",
      storage_path:storagePath,
      original_name:file.name || safeName,
      mime_type:file.type,
      size_bytes:file.size,
      uploaded_by:session.user.id
    }).select().single();
    if (insertError) {
      await c.storage.from("marketplace-partner-documents").remove([storagePath]);
      throw insertError;
    }
    bootstrapCache = null;
    return row;
  }

  async function deletePartnerDocument(document) {
    await assertPartnerResource("document",document.id);
    const c = requireClient();
    if (!document?.id || !document?.storage_path) throw new Error("DOCUMENT_NOT_FOUND");
    const { error: storageError } = await c.storage.from("marketplace-partner-documents").remove([document.storage_path]);
    if (storageError) throw storageError;
    const { error: dbError } = await c.from("partner_documents").delete().eq("id", document.id).select("id").single();
    if (dbError) throw dbError;
    bootstrapCache = null;
  }

  async function createPartnerDocumentSignedUrl(storagePath, expiresIn = 300) {
    const c = requireClient();
    const { data, error } = await c.storage.from("marketplace-partner-documents").createSignedUrl(storagePath, expiresIn);
    if (error) throw error;
    return data?.signedUrl || "";
  }

  async function reviewPartnerDocument(documentId, status, notes = null) {
    return rpc("admin_review_partner_document", { p_document_id:documentId, p_status:status, p_notes:notes });
  }

  async function upsertPartnerTeamMember({ partnerId, email, role, permissions, active = true, pending = false }) {
    if(!pending){
      try { return await rpc("upsert_partner_team_member", {p_partner_id:partnerId,p_email:email,p_role:role,p_permissions:permissions||{},p_active:Boolean(active)}); }
      catch(error){ if(!/TEAM_PROFILE_NOT_FOUND/.test(error?.message||"")) throw error; }
    }
    const data=await invoke("partner-team-community",{action:"assign",partnerId,email,role,permissions:permissions||{},active:Boolean(active)});
    return data.result;
  }

  async function setPartnerTeamMemberActive(memberId, active, pending = false) {
    return pending
      ? rpc("set_pending_community_team_member_active",{p_assignment_id:memberId,p_active:Boolean(active)})
      : rpc("set_partner_team_member_active", {p_member_id:memberId,p_active:Boolean(active)});
  }

  async function assertPartnerResource(resourceType,resourceId) {
    return rpc("assert_partner_resource_operation",{p_resource_type:resourceType,p_resource_id:resourceId});
  }

  async function assertPartnerOperation(partnerId,permission) {
    return rpc("assert_partner_operation",{p_partner_id:partnerId,p_permission:permission});
  }

  async function upsertPartnerClient({partnerId,clientId=null,name,contact,phone,frequency,notes}) {
    return rpc("upsert_partner_client",{p_partner_id:partnerId,p_client_id:clientId,p_name:name,p_contact:contact,p_phone:phone,p_frequency:frequency,p_notes:notes});
  }

  async function updatePartnerProfile(partnerId, patch) {
    await assertPartnerResource("partner",partnerId);
    const c = requireClient();
    const { data, error } = await c.from("partners").update(patch || {}).eq("id", partnerId).select().single();
    if (error) throw error;
    bootstrapCache = null;
    return data;
  }

  async function createVenue(partnerId, input) {
    await assertPartnerResource("partner",partnerId);
    const c = requireClient();
    const { data, error } = await c.from("venues").insert({ partner_id: partnerId, ...input }).select().single();
    if (error) throw error;
    bootstrapCache = null;
    return data;
  }

  async function updateVenue(venueId, patch) {
    await assertPartnerResource("venue",venueId);
    const c = requireClient();
    const { data, error } = await c.from("venues").update(patch || {}).eq("id", venueId).select().single();
    if (error) throw error;
    bootstrapCache = null;
    return data;
  }

  async function createVenueSpace(venueId, input) {
    await assertPartnerResource("space_parent",venueId);
    const c = requireClient();
    const { data, error } = await c.from("venue_spaces").insert({ venue_id: venueId, ...input }).select().single();
    if (error) throw error;
    bootstrapCache = null;
    return data;
  }

  async function updateVenueSpace(spaceId, patch) {
    await assertPartnerResource("space",spaceId);
    const c = requireClient();
    const { data, error } = await c.from("venue_spaces").update(patch || {}).eq("id", spaceId).select().single();
    if (error) throw error;
    bootstrapCache = null;
    return data;
  }

  async function warmPhotoUrls(snapshot) {
    const paths = [...new Set((snapshot.venue_photos || []).map(p => p.storage_path).filter(Boolean))];
    const needed = paths.filter(p => !photoUrls.has(p) || photoUrls.get(p).expires < Date.now() + 120000);
    if (!needed.length) return;
    const { data, error } = await requireClient().storage.from("marketplace-venue-photos").createSignedUrls(needed, 600);
    if (error) throw error;
    for (const item of data || []) if (item.signedUrl) photoUrls.set(item.path, {url:item.signedUrl, expires:Date.now()+600000});
  }

  function publicVenuePhotoUrl(storagePath) {
    return photoUrls.get(storagePath)?.url || "assets/preview-icon.svg";
  }

  async function adminReservationFilters({ partnerId = null, userId = null, date = null, status = null } = {}) {
    return rpc("admin_search_reservations", {
      p_partner_id: partnerId || null,
      p_user_id: userId || null,
      p_date: date || null,
      p_status: status || null
    });
  }

  async function health() {
    return invoke(cfg.functions?.health || "backend-health", {});
  }

  window.MarketplaceBackend = Object.freeze({
    config: cfg,
    init, onStatus, signInWithPassword, signInWithGoogle, signOut,
    beginPartnerReadonly,endPartnerReadonly,assertWritable,
    get readonlyStatus() { return {...readonlyState}; },
    bootstrap, subscribeRealtime, unsubscribeRealtime, invoke, rpc,
    submitPartnerApplication, reviewPartnerApplication, validatePartnerRegistration, sendPartnerValidationUpdate, acceptPartnerOnboarding, adminUpdatePartner, adminDeletePartner,
    createScheduleSeries, setSlotBlocked, deleteScheduleSlots, updateScheduleSlotChain,
    createReservation, createReservationPrebooking, updateReservationPrebooking, contractDirectMonthlyOffer, contractDirectMonthlyPrebooking,
    configureReservationPayment, activateMonthlyCycleWithPolicy, activateMonthlyCyclePrebooking, requestMonthlyCustomerLink, monthlyLinkRequestMessages,
    sendMonthlyLinkRequestMessage, markMonthlyLinkRequestNotificationsRead,
    partnerProposeMonthlyLinkRequest, closeMonthlyLinkRequest,
    acceptMonthlyCustomerLink, confirmMonthlyCycleRenewal,
    syncMonthlyPreReservations, reactivateMonthlyCustomerLink, activateMonthlyCycle, prepareMonthlyFullPrepayment,
    partnerSettleMonthlyShare,
    partnerSettleSingleReservation, routePayment, createPixCharges, simulatePayment, asaasRefund, reservationCancellationPreview, cancelReservation,
    requestMonthlyOccurrenceTransfer, partnerCancelMonthlyOccurrence, occurrenceTransferAvailableSlots,
    occurrenceTransferConversation, sendOccurrenceTransferMessage, markOccurrenceTransferConversationRead,
    proposeMonthlyOccurrenceTransfer, acceptMonthlyOccurrenceTransfer, resolveMonthlyOccurrenceTransferRefund,
    declineMonthlyOccurrenceTransfer, cancelMonthlyOccurrenceTransfer, markReservationNotificationsRead, markOccurrenceTransferNotificationsRead,
    createPromotionalVoucher, deleteVoucher, setPromotionalVoucherActive,
    sendChatMessage, markChatRead,
    communityMarketplaceNotifications, markCommunityMarketplaceNotificationRead,
    uploadVenuePhoto, deleteVenuePhoto, setFavoriteVenuePhoto,
    registrationAction, publishPartnerTerms, uploadPartnerDocument, deletePartnerDocument, createPartnerDocumentSignedUrl, reviewPartnerDocument,
    upsertPartnerTeamMember, setPartnerTeamMemberActive, assertPartnerOperation, upsertPartnerClient,
    updatePartnerProfile, createVenue, updateVenue, createVenueSpace, updateVenueSpace, publicVenuePhotoUrl,
    adminReservationFilters, setMarketplaceUserStatus, health,
    get session() { return session; },
    get client() { return client; },
    get bootstrapCache() { return bootstrapCache; },
    get status() { return statusPayload(); }
  });
})();
