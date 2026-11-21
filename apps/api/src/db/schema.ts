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
