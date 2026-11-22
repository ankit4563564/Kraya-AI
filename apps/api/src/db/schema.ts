import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

const paiseCol = (name: string) => bigint(name, { mode: 'number' });

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  legalName: text('legal_name').notNull(),
  gstin: text('gstin'),
  stateCode: text('state_code').notNull().default('29'),
  gstRegime: text('gst_regime').notNull().default('regular'),
  waccPct: doublePrecision('wacc_pct').notNull().default(15.0),
  turnoverBand: text('turnover_band').notNull().default('under_5cr'),
  defaultOutreachLang: text('default_outreach_lang').notNull().default('english'),
  policyPatchMd: text('policy_patch_md'),
  businessAddress: text('business_address'),
  primaryContactName: text('primary_contact_name'),
  primaryContactPhone: text('primary_contact_phone'),
  primaryContactEmail: text('primary_contact_email'),
  onboardingCompletedAt: timestamp('onboarding_completed_at'),
  autonomyConfigJson: jsonb('autonomy_config_json').notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const suppliers = pgTable('suppliers', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  category: text('category').default('General'),
  gstin: text('gstin'),
  stateCode: text('state_code'),
  gstRegime: text('gst_regime').notNull().default('regular'),
  panEntityType: text('pan_entity_type'),
  udyamNumber: text('udyam_number'),
  udyamTier: text('udyam_tier').notNull().default('unknown'),
  eInvoiceRequired: boolean('e_invoice_required').notNull().default(false),
  creditDays: integer('credit_days').notNull().default(30),
  reliabilityScore: integer('reliability_score').notNull().default(85),
  onboardingStatus: text('onboarding_status').notNull().default('approved'),
  financialHealthScore: integer('financial_health_score').notNull().default(80),
  esgScore: integer('esg_score').notNull().default(75),
  riskStatus: text('risk_status').notNull().default('normal'),
  dunsNumber: text('duns_number'),
  lastRiskAssessedAt: timestamp('last_risk_assessed_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sourceEvents = pgTable('source_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  pillar: text('pillar').notNull().default('quote_capture'),
  supplierId: text('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  rfqId: text('rfq_id'),
  rawContent: text('raw_content').notNull(),
  mediaFileName: text('media_file_name'),
  mediaMimeType: text('media_mime_type'),
  mediaStorageKey: text('media_storage_key'),
  fileId: text('file_id'),
  transcriptText: text('transcript_text'),
  parsedSummary: text('parsed_summary').notNull(),
  extractedJson: jsonb('extracted_json'),
  confidenceScore: doublePrecision('confidence_score').notNull().default(0.9),
  needsVerification: boolean('needs_verification').notNull().default(false),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rfqs = pgTable('rfqs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  rfqNumber: text('rfq_number').notNull(),
  title: text('title').notNull(),
  type: text('type').notNull().default('initial'),
  itemsJson: jsonb('items_json').notNull(),
  deliveryDueAt: text('delivery_due_at'),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const quotes = pgTable('quotes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  rfqId: text('rfq_id')
    .notNull()
    .references(() => rfqs.id, { onDelete: 'cascade' }),
  supplierId: text('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'cascade' }),
  sourceEventId: text('source_event_id').references(() => sourceEvents.id, { onDelete: 'set null' }),
  fileId: text('file_id'),
  quantity: doublePrecision('quantity').notNull().default(1),
  rawRateRupees: doublePrecision('raw_rate_rupees').notNull(),
  rawUnit: text('raw_unit').notNull().default('pc'),
  normalizationNote: text('normalization_note'),
  baseUnitPaise: paiseCol('base_unit_paise').notNull(),
  gstPct: doublePrecision('gst_pct').notNull().default(18),
  isGstInclusive: boolean('is_gst_inclusive').notNull().default(false),
  freightPaise: paiseCol('freight_paise').notNull().default(0),
  freightGstMode: text('freight_gst_mode').notNull().default('composite_supply'),
  creditDays: integer('credit_days').notNull().default(0),
  effectiveCreditDays: integer('effective_credit_days').notNull().default(0),
  leadTimeDays: integer('lead_time_days'),
  netLandedUnitPaise: paiseCol('net_landed_unit_paise').notNull(),
  creditAdjustedUnitPaise: paiseCol('credit_adjusted_unit_paise').notNull(),
  priceDeltaPct: doublePrecision('price_delta_pct'),
  flagsJson: jsonb('flags_json').notNull().default([]),
  evidenceJson: jsonb('evidence_json').notNull().default([]),
  needsVerification: boolean('needs_verification').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const purchaseOrders = pgTable('purchase_orders', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  rfqId: text('rfq_id').references(() => rfqs.id, { onDelete: 'set null' }),
  quoteId: text('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
  supplierId: text('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'restrict' }),
  poNumber: text('po_number').notNull(),
  poDate: text('po_date').notNull(),
  itemsJson: jsonb('items_json').notNull(),
  freightPaise: paiseCol('freight_paise').notNull().default(0),
  taxablePaise: paiseCol('taxable_paise').notNull(),
  cgstPaise: paiseCol('cgst_paise').notNull().default(0),
  sgstPaise: paiseCol('sgst_paise').notNull().default(0),
  igstPaise: paiseCol('igst_paise').notNull().default(0),
  totalPaise: paiseCol('total_paise').notNull(),
  paymentTermsDays: integer('payment_terms_days').notNull().default(30),
  deliveryDueAt: text('delivery_due_at').notNull(),
  invoiceStatus: text('invoice_status').notNull().default('pending'),
  paymentDueAt: text('payment_due_at'),
  pdfFileId: text('pdf_file_id'),
  revisionNumber: integer('revision_number').notNull().default(1),
  cancelledAt: timestamp('cancelled_at'),
  cancelReason: text('cancel_reason'),
  revisionsJson: jsonb('revisions_json').notNull().default([]),
  approvedBy: text('approved_by').notNull().default('Owner'),
  approvedAt: timestamp('approved_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    poId: text('po_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
    supplierId: text('supplier_id').notNull(),
    sourceEventId: text('source_event_id').references(() => sourceEvents.id, { onDelete: 'set null' }),
    fileId: text('file_id'),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceDate: text('invoice_date').notNull(),
    supplierGstin: text('supplier_gstin'),
    irn: text('irn'),
    itemsJson: jsonb('items_json').notNull(),
    taxablePaise: paiseCol('taxable_paise').notNull(),
    cgstPaise: paiseCol('cgst_paise').notNull().default(0),
    sgstPaise: paiseCol('sgst_paise').notNull().default(0),
    igstPaise: paiseCol('igst_paise').notNull().default(0),
    grandTotalPaise: paiseCol('grand_total_paise').notNull(),
    mathReconciled: boolean('math_reconciled').notNull().default(true),
    poMatchStatus: text('po_match_status').notNull().default('unlinked'),
    imsSuggestedAction: text('ims_suggested_action').notNull().default('ACCEPT'),
    totalMoneyLeakPaise: paiseCol('total_money_leak_paise').notNull().default(0),
    flagsJson: jsonb('flags_json').notNull().default([]),
    cfoVerdict: text('cfo_verdict').notNull(),
    paymentDueAt: text('payment_due_at'),
    msme43bhDueAt: text('msme_43bh_due_at'),
    rule37CliffAt: text('rule37_cliff_at'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_invoices_ws_sup_num').on(
      table.workspaceId,
      table.supplierId,
      table.invoiceNumber
    ),
  ]
);

export const moneyLeaks = pgTable('money_leaks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sourceEventId: text('source_event_id').references(() => sourceEvents.id, { onDelete: 'set null' }),
  invoiceId: text('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }),
  quoteId: text('quote_id').references(() => quotes.id, { onDelete: 'cascade' }),
  supplierId: text('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  leakType: text('leak_type').notNull(),
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  statutoryRef: text('statutory_ref'),
  amountPaise: paiseCol('amount_paise').notNull(),
  status: text('status').notNull().default('detected'),
  disputeMessageDraft: text('dispute_message_draft'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});

export const dailyTasks = pgTable('daily_tasks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  supplierId: text('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  relatedId: text('related_id'),
  priority: text('priority').notNull().default('medium'),
  dueAt: text('due_at').notNull(),
  suggestedMessage: text('suggested_message'),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const priceHistory = pgTable('price_history', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  itemKey: text('item_key').notNull(),
  itemDescription: text('item_description').notNull(),
  supplierId: text('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'cascade' }),
  netLandedUnitPaise: paiseCol('net_landed_unit_paise').notNull(),
  unit: text('unit').notNull().default('pc'),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
});

export const amcSchedules = pgTable('amc_schedules', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  assetName: text('asset_name').notNull(),
  supplierId: text('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  frequencyDays: integer('frequency_days').notNull().default(90),
  nextDueAt: text('next_due_at').notNull(),
  lastRatePaise: paiseCol('last_rate_paise'),
  notes: text('notes'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('owner'),
  dpdpConsentAt: timestamp('dpdp_consent_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const workspaceMemberships = pgTable('workspace_memberships', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('clerk'),
  invitedBy: text('invited_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const workspaceInvitations = pgTable('workspace_invitations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  name: text('name'),
  role: text('role').notNull().default('clerk'),
  tokenHash: text('token_hash').notNull(),
  invitedByUserId: text('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const storedFiles = pgTable('stored_files', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  uploadedByUserId: text('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  category: text('category').notNull().default('document'),
  originalFileName: text('original_file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: paiseCol('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  storageProvider: text('storage_provider').notNull(),
  storageKey: text('storage_key').notNull(),
  sourceEventId: text('source_event_id').references(() => sourceEvents.id, { onDelete: 'set null' }),
  quoteId: text('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
  invoiceId: text('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  poId: text('po_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const webhookReceipts = pgTable(
  'webhook_receipts',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_webhook_receipts_provider_ext').on(table.provider, table.externalId),
  ]
);

export const grnReceipts = pgTable('grn_receipts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  poId: text('po_id')
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  supplierId: text('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'restrict' }),
  grnNumber: text('grn_number').notNull(),
  challanNumber: text('challan_number'),
  receivedDate: text('received_date').notNull(),
  acceptedDate: text('accepted_date').notNull(),
  itemsJson: jsonb('items_json').notNull(),
  qcStatus: text('qc_status').notNull().default('accepted'),
  notes: text('notes'),
  fileId: text('file_id'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const creditNotes = pgTable('credit_notes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  supplierId: text('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'restrict' }),
  voucherType: text('voucher_type').notNull().default('credit_note'),
  voucherNumber: text('voucher_number').notNull(),
  voucherDate: text('voucher_date').notNull(),
  taxablePaise: paiseCol('taxable_paise').notNull(),
  cgstPaise: paiseCol('cgst_paise').notNull().default(0),
  sgstPaise: paiseCol('sgst_paise').notNull().default(0),
  igstPaise: paiseCol('igst_paise').notNull().default(0),
  totalPaise: paiseCol('total_paise').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('applied'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  actorEmail: text('actor_email').notNull(),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  metadataJson: jsonb('metadata_json'),
  seqNum: integer('seq_num').notNull().default(0),
  prevHash: text('prev_hash'),
  entryHash: text('entry_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const gstnVerifications = pgTable(
  'gstn_verifications',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    gstin: text('gstin').notNull(),
    checksumValid: boolean('checksum_valid').notNull().default(true),
    liveVerified: boolean('live_verified').notNull().default(false),
    provider: text('provider').notNull().default('offline_checksum_only'),
    taxpayerStatus: text('taxpayer_status').notNull().default('Unverified'),
    legalName: text('legal_name'),
    tradeName: text('trade_name'),
    taxpayerType: text('taxpayer_type').notNull().default('Unknown'),
    inferredGstRegime: text('inferred_gst_regime').notNull().default('regular'),
    eInvoiceEnabled: boolean('e_invoice_enabled'),
    registrationDate: text('registration_date'),
    cancellationDate: text('cancellation_date'),
    riskLevel: text('risk_level').notNull().default('warning'),
    riskFlagsJson: jsonb('risk_flags_json').notNull().default([]),
    rawSummaryJson: jsonb('raw_summary_json'),
    verifiedAt: timestamp('verified_at').defaultNow().notNull(),
    cacheExpiresAt: timestamp('cache_expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_gstn_verifications_ws_gstin').on(table.workspaceId, table.gstin),
  ]
);

export const agentRuns = pgTable('agent_runs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull(),
  triggerSource: text('trigger_source').notNull().default('manual'),
  detectedState: text('detected_state').notNull(),
  riskLevel: text('risk_level').notNull().default('low'),
  confidence: doublePrecision('confidence').notNull().default(0.9),
  brainMode: text('brain_mode').notNull().default('neuro_symbolic_deterministic'),
  headline: text('headline').notNull(),
  executiveVerdict: text('executive_verdict').notNull(),
  reportJson: jsonb('report_json').notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rateLimitHits = pgTable('rate_limit_hits', {
  id: text('id').primaryKey(),
  bucketKey: text('bucket_key').notNull(),
  hitAt: timestamp('hit_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const automationWebhooks = pgTable('automation_webhooks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  provider: text('provider').notNull().default('n8n'),
  targetUrl: text('target_url').notNull(),
  signingSecret: text('signing_secret'),
  subscribedEventsJson: jsonb('subscribed_events_json').notNull().default(['*']),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const automationDeliveries = pgTable('automation_deliveries', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  webhookId: text('webhook_id').references(() => automationWebhooks.id, { onDelete: 'set null' }),
  provider: text('provider').notNull().default('n8n'),
  eventType: text('event_type').notNull(),
  targetUrl: text('target_url').notNull(),
  ok: boolean('ok').notNull().default(false),
  httpStatus: integer('http_status').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  responsePreview: text('response_preview'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const workspaceSubscriptions = pgTable('workspace_subscriptions', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  planCode: text('plan_code').notNull().default('free_pilot'),
  status: text('status').notNull().default('active'),
  monthlyPriceInr: integer('monthly_price_inr').notNull().default(0),
  razorpayOrderId: text('razorpay_order_id'),
  razorpayPaymentId: text('razorpay_payment_id'),
  currentPeriodStart: timestamp('current_period_start').defaultNow().notNull(),
  currentPeriodEnd: timestamp('current_period_end'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const supplierRiskEvents = pgTable('supplier_risk_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  supplierId: text('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'cascade' }),
  sourceProvider: text('source_provider').notNull().default('dnb_risk_feed'),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull().default('high'),
  previousFinancialScore: integer('previous_financial_score'),
  newFinancialScore: integer('new_financial_score'),
  regionOrCategory: text('region_or_category'),
  summary: text('summary').notNull(),
  recommendedAlternativesJson: jsonb('recommended_alternatives_json').notNull().default([]),
  triggeredRfqId: text('triggered_rfq_id').references(() => rfqs.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});

export const supplierContracts = pgTable(
  'supplier_contracts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    rfqId: text('rfq_id').references(() => rfqs.id, { onDelete: 'set null' }),
    poId: text('po_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
    contractNumber: text('contract_number').notNull(),
    title: text('title').notNull(),
    contractType: text('contract_type').notNull().default('msa'),
    status: text('status').notNull().default('under_review'),
    effectiveFrom: text('effective_from').notNull(),
    expiresAt: text('expires_at').notNull(),
    autoRenew: boolean('auto_renew').notNull().default(false),
    noticePeriodDays: integer('notice_period_days').notNull().default(30),
    contractValuePaise: paiseCol('contract_value_paise').notNull().default(0),
    rawContractText: text('raw_contract_text').notNull(),
    clauseRisksJson: jsonb('clause_risks_json').notNull().default([]),
    policyRedlinesJson: jsonb('policy_redlines_json').notNull().default([]),
    complianceScore: integer('compliance_score').notNull().default(100),
    fileId: text('file_id'),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_contracts_ws_num').on(table.workspaceId, table.contractNumber),
  ]
);

export const procurementBudgets = pgTable(
  'procurement_budgets',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    department: text('department').notNull(),
    category: text('category').notNull(),
    periodKey: text('period_key').notNull(),
    allocatedPaise: paiseCol('allocated_paise').notNull(),
    committedPaise: paiseCol('committed_paise').notNull().default(0),
    spentPaise: paiseCol('spent_paise').notNull().default(0),
    hardStop: boolean('hard_stop').notNull().default(true),
    alertThresholdPct: integer('alert_threshold_pct').notNull().default(80),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_budgets_ws_dept_cat_period').on(
      table.workspaceId,
      table.department,
      table.category,
      table.periodKey
    ),
  ]
);

export const purchaseRequisitions = pgTable(
  'purchase_requisitions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prNumber: text('pr_number').notNull(),
    title: text('title').notNull(),
    department: text('department').notNull().default('Operations'),
    category: text('category').notNull().default('General'),
    requestedBy: text('requested_by').notNull(),
    budgetId: text('budget_id').references(() => procurementBudgets.id, { onDelete: 'set null' }),
    estimatedTotalPaise: paiseCol('estimated_total_paise').notNull(),
    itemsJson: jsonb('items_json').notNull().default([]),
    justification: text('justification'),
    urgency: text('urgency').notNull().default('standard'),
    approvalTierRequired: text('approval_tier_required').notNull().default('tier_1_manager'),
    budgetCheckStatus: text('budget_check_status').notNull().default('within_budget'),
    policyViolationsJson: jsonb('policy_violations_json').notNull().default([]),
    status: text('status').notNull().default('pending_approval'),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at'),
    rejectionReason: text('rejection_reason'),
    linkedRfqId: text('linked_rfq_id').references(() => rfqs.id, { onDelete: 'set null' }),
    linkedPoId: text('linked_po_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_prs_ws_num').on(table.workspaceId, table.prNumber),
  ]
);

export const supplierPerformanceLogs = pgTable('supplier_performance_logs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  supplierId: text('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'cascade' }),
  eventSource: text('event_source').notNull(),
  relatedEntityId: text('related_entity_id'),
  onTimeDeliveryScore: integer('on_time_delivery_score'),
  quantityFillRatePct: doublePrecision('quantity_fill_rate_pct'),
  invoiceAccuracyScore: integer('invoice_accuracy_score'),
  rfqResponseHours: doublePrecision('rfq_response_hours'),
  previousReliabilityScore: integer('previous_reliability_score').notNull(),
  newReliabilityScore: integer('new_reliability_score').notNull(),
  notes: text('notes'),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
});


export const integrationHealth = pgTable('integration_health', {
  id: text('id').primaryKey(),
  serviceKey: text('service_key').notNull().unique(),
  status: text('status').notNull(),
  providerMode: text('provider_mode').notNull(),
  lastTestedAt: timestamp('last_tested_at'),
  lastSuccessAt: timestamp('last_success_at'),
  lastError: text('last_error'),
  latencyMs: integer('latency_ms'),
  detailsJson: jsonb('details_json'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
