-- Categories for money you receive, so a payslip is recognized like a bill is:
-- INCOME (the counterpart of EXPENSE), PAYSLIP (a document type) and WORK (a
-- subject). Data only; a category with the same id or title that you created
-- already is kept as it is.
-- Rollback: drizzle/rollback/0007_income_categories.down.sql.
WITH inserted AS (
  INSERT INTO "ingestion"."document_categories" ("id", "title", "description", "template_json", "dimension") VALUES
  ('INCOME', 'Income', 'Any document that proves money you received or are owed: payslips, pension statements, refunds, rent received, invoices you issued.', '{"fields": [{"key": "payer", "label": "Paid by", "type": "string", "description": "Who pays the money", "required": false}, {"key": "payment_date", "label": "Payment date", "type": "date", "description": "Date the money was paid, if stated", "required": false}]}'::jsonb, NULL),
  ('PAYSLIP', 'Payslip', 'A payslip (busta paga, cedolino, LUL) from an employer for one pay period, with gross pay, deductions and net pay.', '{"fields": [{"key": "employer", "label": "Employer", "type": "string", "description": "Company that pays the salary, as printed", "required": true}, {"key": "employee_name", "label": "Employee", "type": "string", "description": "Who is paid, as printed", "required": false}, {"key": "employee_fiscal_code", "label": "Employee fiscal code", "type": "string", "description": "Codice fiscale of the employee", "required": false, "pattern": "^[A-Z0-9]{16}$"}, {"key": "pay_period", "label": "Pay period", "type": "period", "description": "First and last day of the month paid (mese di retribuzione)", "required": true}, {"key": "gross_pay", "label": "Gross pay", "type": "amount", "description": "Total earnings before deductions (totale competenze)", "required": true}, {"key": "total_deductions", "label": "Total deductions", "type": "amount", "description": "Total withheld (totale trattenute)", "required": false}, {"key": "net_pay", "label": "Net pay", "type": "amount", "description": "Amount paid to the employee (netto in busta)", "required": true}, {"key": "currency", "label": "Currency", "type": "currency", "description": "ISO 4217 code, e.g. EUR", "required": false}, {"key": "taxable_income", "label": "Taxable income", "type": "amount", "description": "Income subject to income tax this month (imponibile fiscale)", "required": false}, {"key": "income_tax_withheld", "label": "Income tax withheld", "type": "amount", "description": "Income tax withheld this month (IRPEF netta or trattenuta)", "required": false}, {"key": "social_security_contributions", "label": "Social security contributions", "type": "amount", "description": "Employee share of pension and social contributions (e.g. INPS, totale contributi)", "required": false}, {"key": "hours_worked", "label": "Hours worked", "type": "number", "description": "Ordinary hours worked in the period", "required": false, "unit": "h"}, {"key": "vacation_left", "label": "Vacation left", "type": "number", "description": "Remaining paid vacation (ferie residue)", "required": false, "unit": "h"}, {"key": "leave_left", "label": "Paid leave left", "type": "number", "description": "Remaining paid leave hours (permessi, ROL residui)", "required": false, "unit": "h"}, {"key": "severance_accrued", "label": "Severance accrued", "type": "amount", "description": "Severance pay accrued this month (TFR mese)", "required": false}, {"key": "payment_method", "label": "Payment method", "type": "enum", "description": "How it was or will be paid", "required": false, "options": ["cash", "card", "bank_transfer", "direct_debit", "other"]}, {"key": "contract_type", "label": "Employment contract", "type": "string", "description": "Collective agreement or contract (CCNL), as printed", "required": false}, {"key": "job_level", "label": "Job level", "type": "string", "description": "Level or grade (livello)", "required": false}]}'::jsonb, 'DOCUMENT_TYPE'),
  ('WORK', 'Work', 'Documents about your job: payslips, employment contracts, certifications of income (CU), expense claims, leave.', '{"fields": [{"key": "employer", "label": "Employer", "type": "string", "description": "Company the work is for, as printed", "required": false}]}'::jsonb, 'SUBJECT')
  ON CONFLICT DO NOTHING
  RETURNING "id", "title", "parent_id", "dimension"
)
-- The review inbox keeps its own copy of the categories, fed by category.changed@1.
INSERT INTO "ingestion"."outbox" (event_type, payload)
SELECT 'category.changed@1',
       jsonb_build_object(
         'id', i.id,
         'title', i.title,
         'parentId', i.parent_id,
         'dimension', i.dimension,
         'deleted', false,
         'changedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
  FROM inserted i;
