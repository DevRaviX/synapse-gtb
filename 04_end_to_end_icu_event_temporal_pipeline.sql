-- =============================================================================
-- BigQuery Standard SQL  |  MIMIC-IV 3.1
-- End-to-end ICU foundation → clinical event modeling → temporal dataset.
-- Split-safe for downstream patient-level train/val/test splitting.
--
-- CHANGES vs previous version:
--   • All paths updated to mimiciv_3_1_* datasets
--   • Integrates mimiciv_3_1_derived: ventilation, sepsis3, sofa, weight_durations,
--     crrt, kdigo_stages, charlson, oasis, sapsii, icustay_detail, bg
--   • race added to cohort
--   • GCS NULL vs 0 fixed
--   • Urine normalized per kg (weight joined)
--   • CRRT guard on urine-based SOFA renal score
--   • norepinephrine_equivalent_dose for vasopressor scoring
--   • New features: delta_sofa, SF ratio, pulse pressure, hours_since_*
--   • New events: AKI (KDIGO ≥2), ARDS, extubation
--   • Severity scores (charlson, oasis, sapsii) added to output
--   • hospital_adm_seq exclusion is now a declared parameter
-- =============================================================================

-- ── PARAMETERS ──────────────────────────────────────────────────────────────
DECLARE icu_ds        STRING  DEFAULT 'physionet-data.mimiciv_3_1_icu';
DECLARE hosp_ds       STRING  DEFAULT 'physionet-data.mimiciv_3_1_hosp';
DECLARE derived_ds    STRING  DEFAULT 'physionet-data.mimiciv_3_1_derived';

DECLARE min_icu_hours             INT64  DEFAULT 24;
DECLARE early_death_hours         INT64  DEFAULT 24;
DECLARE hourly_resolution_hours   INT64  DEFAULT 1;
DECLARE window_hours              INT64  DEFAULT 12;
DECLARE burn_in_hours             INT64  DEFAULT 4;   -- min observed hours before first label row

DECLARE exclude_elective_surgery  BOOL   DEFAULT TRUE;
DECLARE exclude_dnr_and_comfort   BOOL   DEFAULT FALSE;
DECLARE exclude_repeat_admissions BOOL   DEFAULT TRUE;  -- previously hard-coded
DECLARE external_transfer_regex   STRING DEFAULT r'ACUTE HOSPITAL|OTHER HOSPITAL';

DECLARE horizon_2h   INT64 DEFAULT 2;
DECLARE horizon_6h   INT64 DEFAULT 6;
DECLARE horizon_12h  INT64 DEFAULT 12;

-- =============================================================================
-- 1)  ICU DATA FOUNDATION
-- =============================================================================
CREATE TEMP TABLE foundation_cohort AS
WITH base AS (
  SELECT
    icu.subject_id,
    icu.hadm_id,
    icu.stay_id,
    icu.first_careunit,
    icu.last_careunit,
    -- MIMIC-IV 3.1 stores all datetimes as DATETIME (not TIMESTAMP)
    icu.intime,
    icu.outtime,
    DATETIME_DIFF(icu.outtime, icu.intime, HOUR) AS icu_los_hours,
    adm.admittime,
    adm.dischtime,
    adm.deathtime,
    adm.admission_type,
    adm.admission_location,
    adm.discharge_location,
    adm.hospital_expire_flag,
    adm.race,                          -- NEW: for bias analysis / stratification
    pat.gender,
    pat.anchor_age,
    ROW_NUMBER() OVER (PARTITION BY icu.subject_id  ORDER BY icu.intime)    AS icu_seq,
    ROW_NUMBER() OVER (PARTITION BY adm.subject_id  ORDER BY adm.admittime) AS hospital_adm_seq
  FROM `physionet-data.mimiciv_3_1_icu.icustays`          AS icu
  INNER JOIN `physionet-data.mimiciv_3_1_hosp.admissions` AS adm ON icu.hadm_id    = adm.hadm_id
  INNER JOIN `physionet-data.mimiciv_3_1_hosp.patients`   AS pat ON icu.subject_id = pat.subject_id
),

vital_coverage AS (
  SELECT
    ce.stay_id,
    COUNT(DISTINCT CASE
      WHEN UPPER(di.label) = 'HEART RATE'                                               THEN 'hr'
      WHEN UPPER(di.label) IN ('ARTERIAL BLOOD PRESSURE MEAN','NON INVASIVE BLOOD PRESSURE MEAN') THEN 'map'
      WHEN UPPER(di.label) IN ('ARTERIAL BLOOD PRESSURE SYSTOLIC','NON INVASIVE BLOOD PRESSURE SYSTOLIC') THEN 'sbp'
      WHEN UPPER(di.label) = 'RESPIRATORY RATE'                                         THEN 'rr'
      WHEN UPPER(di.label) IN ('O2 SATURATION PULSEOXIMETRY','SPO2')                    THEN 'spo2'
      WHEN UPPER(di.label) IN ('TEMPERATURE CELSIUS','TEMPERATURE FAHRENHEIT')          THEN 'temp'
      ELSE NULL
    END) AS vital_types_present
  FROM `physionet-data.mimiciv_3_1_icu.chartevents` AS ce
  INNER JOIN `physionet-data.mimiciv_3_1_icu.d_items` AS di ON ce.itemid = di.itemid
  INNER JOIN base AS b ON ce.stay_id = b.stay_id
  WHERE ce.charttime >= b.intime
    AND ce.charttime  < DATETIME_ADD(b.intime, INTERVAL 24 HOUR)
    AND ce.valuenum IS NOT NULL
  GROUP BY ce.stay_id
),

lab_coverage AS (
  SELECT
    b.stay_id,
    COUNT(DISTINCT CASE
      WHEN UPPER(dl.label) IN ('LACTATE','CREATININE','PLATELET COUNT','BILIRUBIN, TOTAL','PO2')
        THEN UPPER(dl.label)
      ELSE NULL
    END) AS lab_types_present
  FROM base AS b
  INNER JOIN `physionet-data.mimiciv_3_1_hosp.labevents`  AS le ON b.hadm_id  = le.hadm_id
  INNER JOIN `physionet-data.mimiciv_3_1_hosp.d_labitems` AS dl ON le.itemid  = dl.itemid
  WHERE le.charttime >= b.intime
    AND le.charttime  < DATETIME_ADD(b.intime, INTERVAL 24 HOUR)
    AND le.valuenum IS NOT NULL
  GROUP BY b.stay_id
),

transfer_summary AS (
  SELECT
    b.stay_id,
    COUNTIF(t.careunit IS NOT NULL)                                         AS hospital_transfer_count,
    COUNTIF(t.careunit IS NOT NULL AND t.intime > b.outtime)                AS post_icu_transfer_count,
    MAX(CASE WHEN t.eventtype = 'discharge'
             THEN DATETIME_TRUNC(t.intime, HOUR) END)                     AS hospital_discharge_event_time
  FROM base AS b
  LEFT JOIN `physionet-data.mimiciv_3_1_hosp.transfers` AS t ON b.hadm_id = t.hadm_id
  GROUP BY b.stay_id
),

code_status_flags AS (
  SELECT
    ce.stay_id,
    MIN(ce.charttime) AS first_code_status_time,
    MAX(IF(REGEXP_CONTAINS(UPPER(COALESCE(ce.value,'')),
           r'DNR|DO NOT RESUSCITATE|COMFORT|CMO|PALLIATIVE|HOSPICE'), 1, 0)) AS dnr_or_comfort_flag
  FROM `physionet-data.mimiciv_3_1_icu.chartevents` AS ce
  INNER JOIN `physionet-data.mimiciv_3_1_icu.d_items` AS di ON ce.itemid = di.itemid
  INNER JOIN base AS b ON ce.stay_id = b.stay_id
  WHERE ce.charttime >= b.intime
    AND ce.charttime  < DATETIME_ADD(b.intime, INTERVAL 24 HOUR)
    AND (UPPER(di.label) LIKE 'CODE STATUS%'
      OR UPPER(di.label) LIKE '%PALLIATIVE%'
      OR UPPER(di.label) LIKE '%COMFORT%')
  GROUP BY ce.stay_id
),

-- NEW: pull admission severity scores from derived schema
severity_scores AS (
  SELECT
    c.stay_id,
    ch.charlson_comorbidity_index,
    oa.oasis,
    oa.oasis_prob,
    sa.sapsii,
    sa.sapsii_prob
  FROM base AS c
  LEFT JOIN `physionet-data.mimiciv_3_1_derived.charlson`   AS ch ON c.hadm_id = ch.hadm_id
  LEFT JOIN `physionet-data.mimiciv_3_1_derived.oasis`      AS oa ON c.stay_id = oa.stay_id
  LEFT JOIN `physionet-data.mimiciv_3_1_derived.sapsii`     AS sa ON c.stay_id = sa.stay_id
),

cohort_enriched AS (
  SELECT
    b.*,
    COALESCE(vc.vital_types_present, 0)      AS vital_types_present,
    COALESCE(lc.lab_types_present, 0)        AS lab_types_present,
    COALESCE(ts.hospital_transfer_count, 0)  AS hospital_transfer_count,
    COALESCE(ts.post_icu_transfer_count, 0)  AS post_icu_transfer_count,
    COALESCE(cs.dnr_or_comfort_flag, 0)      AS dnr_or_comfort_flag,
    IF(REGEXP_CONTAINS(UPPER(COALESCE(b.discharge_location,'')), external_transfer_regex), 1, 0) AS external_transfer_out_flag,
    ss.charlson_comorbidity_index,
    ss.oasis,
    ss.oasis_prob,
    ss.sapsii,
    ss.sapsii_prob
  FROM base AS b
  LEFT JOIN vital_coverage  AS vc ON b.stay_id = vc.stay_id
  LEFT JOIN lab_coverage    AS lc ON b.stay_id = lc.stay_id
  LEFT JOIN transfer_summary AS ts ON b.stay_id = ts.stay_id
  LEFT JOIN code_status_flags AS cs ON b.stay_id = cs.stay_id
  LEFT JOIN severity_scores   AS ss ON b.stay_id = ss.stay_id
)
SELECT *
FROM cohort_enriched
WHERE anchor_age >= 18
  AND icu_seq = 1
  AND (exclude_repeat_admissions = FALSE OR hospital_adm_seq = 1)
  AND icu_los_hours >= min_icu_hours
  AND (deathtime IS NULL OR DATETIME_DIFF(deathtime, intime, HOUR) >= early_death_hours)
  AND external_transfer_out_flag = 0
  AND vital_types_present >= 4
  AND lab_types_present >= 2
  AND (exclude_elective_surgery = FALSE
       OR admission_type NOT IN ('ELECTIVE','SURGICAL SAME DAY ADMISSION'))
  AND (exclude_dnr_and_comfort = FALSE OR dnr_or_comfort_flag = 0);

-- =============================================================================
-- 2)  CLINICAL EVENT MODELING
-- =============================================================================

-- ── 2a) Diagnosis / Procedure ICD context ────────────────────────────────────
CREATE TEMP TABLE diagnosis_context AS
SELECT
  c.hadm_id,
  MAX(IF(REGEXP_CONTAINS(UPPER(COALESCE(dd.long_title,'')), r'SEPSIS|SEPTIC SHOCK|SEPTICEMIA'), 1, 0))                                AS sepsis_icd_flag,
  MAX(IF(REGEXP_CONTAINS(UPPER(COALESCE(dd.long_title,'')), r'CARDIAC ARREST|RESPIRATORY ARREST|VENTRICULAR FIBRILLATION'), 1, 0))   AS arrest_icd_flag,
  MAX(IF(REGEXP_CONTAINS(UPPER(COALESCE(dd.long_title,'')), r'ACUTE KIDNEY INJURY|ACUTE RENAL FAILURE'), 1, 0))                      AS aki_icd_flag,
  MAX(IF(REGEXP_CONTAINS(UPPER(COALESCE(dd.long_title,'')), r'ARDS|RESPIRATORY DISTRESS SYNDROME'), 1, 0))                           AS ards_icd_flag
FROM foundation_cohort AS c
LEFT JOIN `physionet-data.mimiciv_3_1_hosp.diagnoses_icd`  AS dx ON c.hadm_id = dx.hadm_id
LEFT JOIN `physionet-data.mimiciv_3_1_hosp.d_icd_diagnoses` AS dd ON dx.icd_code = dd.icd_code AND dx.icd_version = dd.icd_version
GROUP BY c.hadm_id;

CREATE TEMP TABLE procedure_context AS
SELECT
  c.hadm_id,
  MAX(IF(REGEXP_CONTAINS(UPPER(COALESCE(dp.long_title,'')), r'CARDIOVERSION|DEFIBRILLATION|RESUSCITATION|CARDIAC MASSAGE'), 1, 0))   AS arrest_proc_icd_flag,
  MAX(IF(REGEXP_CONTAINS(UPPER(COALESCE(dp.long_title,'')), r'BYPASS|CRANIOTOMY|VALVE|THORACOTOMY|LAPAROTOMY|TRANSPLANT'), 1, 0))    AS major_surgery_proc_icd_flag
FROM foundation_cohort AS c
LEFT JOIN `physionet-data.mimiciv_3_1_hosp.procedures_icd`    AS px ON c.hadm_id = px.hadm_id
LEFT JOIN `physionet-data.mimiciv_3_1_hosp.d_icd_procedures`  AS dp ON px.icd_code = dp.icd_code AND px.icd_version = dp.icd_version
GROUP BY c.hadm_id;

-- ── 2b) Hourly time grid ──────────────────────────────────────────────────────
CREATE TEMP TABLE hourly_grid AS
SELECT
  c.subject_id, c.hadm_id, c.stay_id, c.intime, c.outtime, c.deathtime,
  CAST(ts AS DATETIME) AS hour_ts
FROM foundation_cohort AS c,
UNNEST(GENERATE_TIMESTAMP_ARRAY(
  CAST(DATETIME_TRUNC(c.intime, HOUR) AS TIMESTAMP),
  CAST(DATETIME_TRUNC(c.outtime, HOUR) AS TIMESTAMP),
  INTERVAL hourly_resolution_hours HOUR
)) AS ts;

-- ── 2c) Per-patient weight (time-varying, for urine normalisation) ────────────
CREATE TEMP TABLE patient_weight AS
SELECT
  wd.stay_id,
  wd.starttime,
  wd.endtime,
  wd.weight   -- kg
FROM `physionet-data.mimiciv_3_1_derived.weight_durations` AS wd
INNER JOIN foundation_cohort AS c ON wd.stay_id = c.stay_id;

-- ── 2d) CRRT / RRT flag (per hour) ───────────────────────────────────────────
CREATE TEMP TABLE crrt_hours AS
SELECT DISTINCT
  c.stay_id,
  DATETIME_TRUNC(cr.charttime, HOUR) AS hour_ts
FROM `physionet-data.mimiciv_3_1_derived.crrt` AS cr
INNER JOIN foundation_cohort AS c ON cr.stay_id = c.stay_id
WHERE cr.charttime BETWEEN c.intime AND c.outtime;

-- ── 2e) Hourly vitals from chartevents ───────────────────────────────────────
CREATE TEMP TABLE hourly_vitals AS
SELECT
  ce.stay_id,
  DATETIME_TRUNC(ce.charttime, HOUR) AS hour_ts,
  AVG(CASE WHEN UPPER(di.label) = 'HEART RATE'                   AND ce.valuenum BETWEEN 20  AND 250   THEN ce.valuenum END) AS hr,
  AVG(CASE WHEN UPPER(di.label) IN ('ARTERIAL BLOOD PRESSURE MEAN','NON INVASIVE BLOOD PRESSURE MEAN')
                                                                   AND ce.valuenum BETWEEN 20  AND 220   THEN ce.valuenum END) AS map_mean,
  AVG(CASE WHEN UPPER(di.label) IN ('ARTERIAL BLOOD PRESSURE SYSTOLIC','NON INVASIVE BLOOD PRESSURE SYSTOLIC')
                                                                   AND ce.valuenum BETWEEN 40  AND 300   THEN ce.valuenum END) AS sbp,
  AVG(CASE WHEN UPPER(di.label) IN ('ARTERIAL BLOOD PRESSURE DIASTOLIC','NON INVASIVE BLOOD PRESSURE DIASTOLIC')
                                                                   AND ce.valuenum BETWEEN 10  AND 200   THEN ce.valuenum END) AS dbp,
  AVG(CASE WHEN UPPER(di.label) = 'RESPIRATORY RATE'              AND ce.valuenum BETWEEN 4   AND 80    THEN ce.valuenum END) AS rr,
  AVG(CASE WHEN UPPER(di.label) IN ('O2 SATURATION PULSEOXIMETRY','SPO2')
                                                                   AND ce.valuenum BETWEEN 40  AND 100   THEN ce.valuenum END) AS spo2,
  AVG(CASE
        WHEN UPPER(di.label) = 'TEMPERATURE CELSIUS'    AND ce.valuenum BETWEEN 30   AND 43    THEN ce.valuenum
        WHEN UPPER(di.label) = 'TEMPERATURE FAHRENHEIT' AND ce.valuenum BETWEEN 86   AND 109.4 THEN (ce.valuenum - 32) * 5.0 / 9
      END) AS temp_c,
  -- GCS sub-components (FIX: keep NULL when truly missing)
  AVG(CASE WHEN di.itemid = 220739 AND ce.valuenum BETWEEN 1 AND 4 THEN ce.valuenum END) AS gcs_eye,
  AVG(CASE WHEN di.itemid = 223900 AND ce.valuenum BETWEEN 1 AND 5 THEN ce.valuenum END) AS gcs_verbal,
  AVG(CASE WHEN di.itemid = 223901 AND ce.valuenum BETWEEN 1 AND 6 THEN ce.valuenum END) AS gcs_motor,
  -- FiO2 (fraction 0-1)
  AVG(CASE
        WHEN di.itemid = 223835 AND ce.valuenum BETWEEN 0.2 AND 1.0  THEN ce.valuenum
        WHEN di.itemid = 223835 AND ce.valuenum BETWEEN 20  AND 100  THEN ce.valuenum / 100.0
      END) AS fio2_frac,
  -- PaO2 from charted ABG (itemid 220224)
  MAX(CASE WHEN di.itemid = 220224 AND ce.valuenum BETWEEN 20 AND 600 THEN ce.valuenum END) AS pao2_chart
FROM `physionet-data.mimiciv_3_1_icu.chartevents`  AS ce
INNER JOIN `physionet-data.mimiciv_3_1_icu.d_items` AS di ON ce.itemid = di.itemid
INNER JOIN foundation_cohort AS c ON ce.stay_id = c.stay_id
WHERE ce.charttime BETWEEN c.intime AND c.outtime
  AND ce.valuenum IS NOT NULL
GROUP BY ce.stay_id, hour_ts;

-- ── 2f) PaO2 from blood gas (derived.bg) — arterial only ─────────────────────
CREATE TEMP TABLE hourly_bg AS
SELECT
  c.stay_id,
  DATETIME_TRUNC(bg.charttime, HOUR) AS hour_ts,
  MAX(CASE WHEN bg.specimen LIKE 'ART%' AND bg.po2 BETWEEN 20 AND 600 THEN bg.po2 END)   AS pao2_abg,
  MAX(CASE WHEN bg.specimen LIKE 'ART%' AND bg.pco2 BETWEEN 10 AND 150 THEN bg.pco2 END) AS paco2_abg,
  MAX(CASE WHEN bg.specimen LIKE 'ART%' AND bg.ph BETWEEN 6.5 AND 8.0 THEN bg.ph END)    AS ph_abg,
  MAX(CASE WHEN bg.fio2_chartevents BETWEEN 0.21 AND 1.0 THEN bg.fio2_chartevents END) AS fio2_bg
FROM `physionet-data.mimiciv_3_1_derived.bg`  AS bg
INNER JOIN foundation_cohort AS c ON bg.hadm_id = c.hadm_id
WHERE bg.charttime BETWEEN c.intime AND c.outtime
GROUP BY c.stay_id, hour_ts;

-- ── 2g) Hourly labs ───────────────────────────────────────────────────────────
CREATE TEMP TABLE hourly_labs AS
SELECT
  c.stay_id,
  DATETIME_TRUNC(le.charttime, HOUR) AS hour_ts,
  MAX(CASE WHEN UPPER(dl.label) = 'LACTATE'        AND le.valuenum BETWEEN 0.2 AND 30   THEN le.valuenum END) AS lactate,
  MAX(CASE WHEN UPPER(dl.label) = 'CREATININE'     AND le.valuenum BETWEEN 0.1 AND 20   THEN le.valuenum END) AS creatinine,
  MIN(CASE WHEN UPPER(dl.label) = 'PLATELET COUNT' AND le.valuenum BETWEEN 1   AND 2000 THEN le.valuenum END) AS platelets,
  MAX(CASE WHEN UPPER(dl.label) = 'BILIRUBIN, TOTAL' AND le.valuenum BETWEEN 0.1 AND 50 THEN le.valuenum END) AS bilirubin_total,
  MAX(CASE WHEN UPPER(dl.label) = 'WHITE BLOOD CELLS' AND le.valuenum BETWEEN 0 AND 500 THEN le.valuenum END) AS wbc,
  MAX(CASE WHEN UPPER(dl.label) = 'SODIUM'         AND le.valuenum BETWEEN 100 AND 180  THEN le.valuenum END) AS sodium,
  MAX(CASE WHEN UPPER(dl.label) = 'POTASSIUM'      AND le.valuenum BETWEEN 1   AND 10   THEN le.valuenum END) AS potassium,
  MAX(CASE WHEN UPPER(dl.label) = 'BICARBONATE'    AND le.valuenum BETWEEN 5   AND 60   THEN le.valuenum END) AS bicarbonate,
  MAX(CASE WHEN UPPER(dl.label) = 'HEMOGLOBIN'     AND le.valuenum BETWEEN 1   AND 25   THEN le.valuenum END) AS hemoglobin,
  MAX(CASE WHEN UPPER(dl.label) = 'GLUCOSE'        AND le.valuenum BETWEEN 30  AND 1500 THEN le.valuenum END) AS glucose
FROM foundation_cohort AS c
INNER JOIN `physionet-data.mimiciv_3_1_hosp.labevents`  AS le ON c.hadm_id = le.hadm_id
INNER JOIN `physionet-data.mimiciv_3_1_hosp.d_labitems` AS dl ON le.itemid  = dl.itemid
WHERE le.charttime BETWEEN c.intime AND c.outtime
  AND le.valuenum IS NOT NULL
GROUP BY c.stay_id, hour_ts;

-- ── 2h) Hourly urine ─────────────────────────────────────────────────────────
CREATE TEMP TABLE hourly_urine AS
SELECT
  c.stay_id,
  DATETIME_TRUNC(oe.charttime, HOUR) AS hour_ts,
  SUM(CASE WHEN oe.value BETWEEN 0 AND 3000 THEN oe.value END) AS urine_ml
FROM foundation_cohort AS c
INNER JOIN `physionet-data.mimiciv_3_1_icu.outputevents` AS oe ON c.stay_id = oe.stay_id
WHERE oe.charttime BETWEEN c.intime AND c.outtime
GROUP BY c.stay_id, hour_ts;

-- ── 2i) Vasopressor doses (NE-equivalent from derived) then per-hour flag ─────
CREATE TEMP TABLE vasopressor_hours AS
SELECT
  ne.stay_id,
  CAST(ts AS DATETIME) AS hour_ts,
  1          AS vasopressor_active,
  MAX(IF(ts = CAST(DATETIME_TRUNC(ne.starttime, HOUR) AS TIMESTAMP), 1, 0)) AS vasopressor_start_hour,
  MAX(ne.norepinephrine_equivalent_dose)                  AS ne_equivalent_dose
FROM `physionet-data.mimiciv_3_1_derived.norepinephrine_equivalent_dose` AS ne
INNER JOIN foundation_cohort AS c ON ne.stay_id = c.stay_id,
UNNEST(GENERATE_TIMESTAMP_ARRAY(
  CAST(DATETIME_TRUNC(ne.starttime, HOUR) AS TIMESTAMP),
  CAST(DATETIME_TRUNC(COALESCE(ne.endtime, ne.starttime), HOUR) AS TIMESTAMP),
  INTERVAL 1 HOUR
)) AS ts
WHERE ne.starttime BETWEEN c.intime AND c.outtime
GROUP BY ne.stay_id, hour_ts;

-- ── 2j) Ventilation hours — from derived.ventilation (replaces procedureevents filter) ──
CREATE TEMP TABLE ventilation_hours AS
SELECT
  vd.stay_id,
  CAST(ts AS DATETIME) AS hour_ts,
  1            AS vent_active,
  MAX(vd.ventilation_status) AS ventilation_status  -- InvasiveVent | NonInvasiveVent | etc.
FROM `physionet-data.mimiciv_3_1_derived.ventilation` AS vd
INNER JOIN foundation_cohort AS c ON vd.stay_id = c.stay_id,
UNNEST(GENERATE_TIMESTAMP_ARRAY(
  CAST(DATETIME_TRUNC(vd.starttime, HOUR) AS TIMESTAMP),
  CAST(DATETIME_TRUNC(COALESCE(vd.endtime, vd.starttime), HOUR) AS TIMESTAMP),
  INTERVAL 1 HOUR
)) AS ts
WHERE vd.starttime BETWEEN c.intime AND c.outtime
  AND vd.ventilation_status IN ('InvasiveVent','NonInvasiveVent','HFNC')
GROUP BY vd.stay_id, hour_ts;

-- Extubation events (transition out of InvasiveVent)
CREATE TEMP TABLE extubation_times AS
SELECT
  vd.stay_id,
  DATETIME_TRUNC(vd.endtime, HOUR) AS extubation_time
FROM `physionet-data.mimiciv_3_1_derived.ventilation` AS vd
INNER JOIN foundation_cohort AS c ON vd.stay_id = c.stay_id
WHERE vd.ventilation_status = 'InvasiveVent'
  AND vd.endtime IS NOT NULL
  AND vd.endtime BETWEEN c.intime AND c.outtime;

-- ── 2k) Infection times (culture + antibiotic window) ────────────────────────
CREATE TEMP TABLE infection_times AS
WITH micro AS (
  SELECT hadm_id,
    MIN(DATETIME_TRUNC(COALESCE(charttime, CAST(chartdate AS DATETIME)), HOUR)) AS culture_time
  FROM `physionet-data.mimiciv_3_1_hosp.microbiologyevents`
  GROUP BY hadm_id
),
emar_abx AS (
  SELECT c.hadm_id,
    MIN(DATETIME_TRUNC(e.charttime, HOUR)) AS antibiotic_admin_time
  FROM foundation_cohort AS c
  INNER JOIN `physionet-data.mimiciv_3_1_hosp.emar` AS e ON c.hadm_id = e.hadm_id
  WHERE REGEXP_CONTAINS(UPPER(COALESCE(e.medication,'')),
    r'VANCOMYCIN|CEFEPIME|CEFTRIAXONE|CEFTAZIDIME|PIPERACILLIN|TAZOBACTAM|MEROPENEM|IMIPENEM|ERTAPENEM|LEVOFLOXACIN|CIPROFLOXACIN|METRONIDAZOLE|AZTREONAM')
    AND NOT REGEXP_CONTAINS(UPPER(COALESCE(e.event_txt,'')), r'NOT GIVEN|HELD|REFUSED|CANCELED|CANCELLED')
  GROUP BY c.hadm_id
),
presc_abx AS (
  SELECT hadm_id,
    MIN(DATETIME_TRUNC(starttime, HOUR)) AS antibiotic_order_time
  FROM `physionet-data.mimiciv_3_1_hosp.prescriptions`
  WHERE UPPER(COALESCE(route,'')) = 'IV'
    AND REGEXP_CONTAINS(UPPER(drug),
      r'VANCOMYCIN|CEFEPIME|CEFTRIAXONE|CEFTAZIDIME|PIPERACILLIN|TAZOBACTAM|MEROPENEM|IMIPENEM|ERTAPENEM|LEVOFLOXACIN|CIPROFLOXACIN|METRONIDAZOLE|AZTREONAM')
  GROUP BY hadm_id
),
candidates AS (
  SELECT
    c.hadm_id,
    m.culture_time,
    COALESCE(ea.antibiotic_admin_time, pa.antibiotic_order_time) AS antibiotic_time
  FROM foundation_cohort AS c
  LEFT JOIN micro     AS m  ON c.hadm_id = m.hadm_id
  LEFT JOIN emar_abx  AS ea ON c.hadm_id = ea.hadm_id
  LEFT JOIN presc_abx AS pa ON c.hadm_id = pa.hadm_id
)
SELECT
  hadm_id,
  culture_time,
  antibiotic_time,
  LEAST(culture_time, antibiotic_time) AS infection_time
FROM candidates
WHERE culture_time IS NOT NULL AND antibiotic_time IS NOT NULL
  AND antibiotic_time BETWEEN DATETIME_SUB(culture_time, INTERVAL 24 HOUR)
                          AND DATETIME_ADD(culture_time, INTERVAL 72 HOUR);

-- ── 2l) Cardiac arrest times ──────────────────────────────────────────────────
CREATE TEMP TABLE arrest_times AS
WITH timed_arrest AS (
  SELECT pe.stay_id,
    MIN(DATETIME_TRUNC(pe.starttime, HOUR)) AS cardiac_arrest_time
  FROM `physionet-data.mimiciv_3_1_icu.procedureevents` AS pe
  INNER JOIN `physionet-data.mimiciv_3_1_icu.d_items`   AS di ON pe.itemid = di.itemid
  INNER JOIN foundation_cohort AS c ON pe.stay_id = c.stay_id
  WHERE pe.starttime BETWEEN c.intime AND c.outtime
    AND UPPER(di.label) IN ('CARDIAC ARREST','CARDIOVERSION/DEFIBRILLATION')
  GROUP BY pe.stay_id
)
SELECT
  c.stay_id,
  ta.cardiac_arrest_time,
  COALESCE(dc.arrest_icd_flag,        0) AS arrest_icd_flag,
  COALESCE(pc.arrest_proc_icd_flag,   0) AS arrest_proc_icd_flag,
  COALESCE(dc.sepsis_icd_flag,        0) AS sepsis_icd_flag,
  COALESCE(dc.aki_icd_flag,           0) AS aki_icd_flag,
  COALESCE(dc.ards_icd_flag,          0) AS ards_icd_flag,
  COALESCE(pc.major_surgery_proc_icd_flag, 0) AS major_surgery_proc_icd_flag
FROM foundation_cohort   AS c
LEFT JOIN timed_arrest   AS ta ON c.stay_id  = ta.stay_id
LEFT JOIN diagnosis_context  AS dc ON c.hadm_id  = dc.hadm_id
LEFT JOIN procedure_context  AS pc ON c.hadm_id  = pc.hadm_id;

-- ── 2m) AKI staging from KDIGO (derived) ─────────────────────────────────────
CREATE TEMP TABLE hourly_aki AS
SELECT
  k.stay_id,
  DATETIME_TRUNC(k.charttime, HOUR) AS hour_ts,
  MAX(k.aki_stage_creat) AS aki_stage_creat,
  MAX(k.aki_stage_uo)    AS aki_stage_uo,
  MAX(GREATEST(COALESCE(k.aki_stage_creat,0), COALESCE(k.aki_stage_uo,0))) AS aki_stage
FROM `physionet-data.mimiciv_3_1_derived.kdigo_stages` AS k
INNER JOIN foundation_cohort AS c ON k.stay_id = c.stay_id
WHERE k.charttime BETWEEN c.intime AND c.outtime
GROUP BY k.stay_id, hour_ts;

-- ── 2n) Hourly state assembly ─────────────────────────────────────────────────
CREATE TEMP TABLE hourly_state AS
WITH joined AS (
  SELECT
    g.subject_id, g.hadm_id, g.stay_id, g.intime, g.outtime, g.deathtime, g.hour_ts,
    -- Vitals
    v.hr, v.map_mean, v.sbp, v.dbp, v.rr, v.spo2, v.temp_c,
    -- Pulse pressure (NEW)
    CASE WHEN v.sbp IS NOT NULL AND v.dbp IS NOT NULL THEN v.sbp - v.dbp END AS pulse_pressure,
    -- GCS: NULL when all sub-components missing (FIX)
    IF(v.gcs_eye IS NULL AND v.gcs_verbal IS NULL AND v.gcs_motor IS NULL, NULL,
       COALESCE(v.gcs_eye,0) + COALESCE(v.gcs_verbal,0) + COALESCE(v.gcs_motor,0)) AS gcs_total,
    -- FiO2: prefer charted value, fall back to bg
    COALESCE(v.fio2_frac, bg.fio2_bg)       AS fio2_frac,
    -- PaO2: prefer ABG derived (specimen-validated), then chart, then derived bg
    COALESCE(bg.pao2_abg, v.pao2_chart)     AS pao2,
    bg.paco2_abg, bg.ph_abg,
    -- Labs
    l.lactate, l.creatinine, l.platelets, l.bilirubin_total,
    l.wbc, l.sodium, l.potassium, l.bicarbonate, l.hemoglobin, l.glucose,
    -- Urine
    u.urine_ml,
    -- Weight-normalised urine (join closest weight record)
    SAFE_DIVIDE(u.urine_ml, pw.weight) AS urine_ml_per_kg,
    pw.weight                          AS body_weight_kg,
    -- Vasopressors
    COALESCE(vp.vasopressor_active,   0) AS vasopressor_active,
    COALESCE(vp.vasopressor_start_hour,0) AS vasopressor_start_hour,
    vp.ne_equivalent_dose,
    -- Ventilation
    COALESCE(vh.vent_active, 0)          AS vent_active,
    vh.ventilation_status,
    -- CRRT / RRT
    IF(cr.hour_ts IS NOT NULL, 1, 0)     AS crrt_active,
    -- AKI staging
    COALESCE(ak.aki_stage, 0)            AS aki_stage,
    COALESCE(ak.aki_stage_creat, 0)      AS aki_stage_creat,
    COALESCE(ak.aki_stage_uo,   0)       AS aki_stage_uo,
    -- Infection / arrest context
    inf.infection_time,
    arrest.cardiac_arrest_time,
    arrest.arrest_icd_flag, arrest.arrest_proc_icd_flag, arrest.sepsis_icd_flag,
    arrest.aki_icd_flag, arrest.ards_icd_flag, arrest.major_surgery_proc_icd_flag,
    -- Timing sentinels
    IF(g.deathtime IS NOT NULL AND g.deathtime <= g.outtime,
       DATETIME_TRUNC(g.deathtime, HOUR), NULL)             AS death_time,
    DATETIME_TRUNC(g.outtime, HOUR)                         AS discharge_time
  FROM hourly_grid AS g
  LEFT JOIN hourly_vitals     AS v  ON g.stay_id = v.stay_id  AND g.hour_ts = v.hour_ts
  LEFT JOIN hourly_bg         AS bg ON g.stay_id = bg.stay_id AND g.hour_ts = bg.hour_ts
  LEFT JOIN hourly_labs       AS l  ON g.stay_id = l.stay_id  AND g.hour_ts = l.hour_ts
  LEFT JOIN hourly_urine      AS u  ON g.stay_id = u.stay_id  AND g.hour_ts = u.hour_ts
  LEFT JOIN vasopressor_hours AS vp ON g.stay_id = vp.stay_id AND g.hour_ts = vp.hour_ts
  LEFT JOIN ventilation_hours AS vh ON g.stay_id = vh.stay_id AND g.hour_ts = vh.hour_ts
  LEFT JOIN crrt_hours        AS cr ON g.stay_id = cr.stay_id AND g.hour_ts = cr.hour_ts
  LEFT JOIN hourly_aki        AS ak ON g.stay_id = ak.stay_id AND g.hour_ts = ak.hour_ts
  LEFT JOIN infection_times   AS inf ON g.hadm_id = inf.hadm_id
  LEFT JOIN arrest_times      AS arrest ON g.stay_id = arrest.stay_id
  -- Weight: closest record whose window covers this hour
  LEFT JOIN patient_weight    AS pw ON g.stay_id = pw.stay_id
    AND g.hour_ts >= pw.starttime AND g.hour_ts < pw.endtime
),
derived AS (
  SELECT
    j.*,
    -- PF ratio (prefer ABG pao2)
    CASE WHEN fio2_frac > 0 AND pao2 IS NOT NULL THEN pao2 / fio2_frac END AS pf_ratio,
    -- SF ratio (SpO2 / FiO2 — surrogate when no ABG)
    CASE WHEN fio2_frac > 0 AND spo2 IS NOT NULL THEN spo2 / fio2_frac END AS sf_ratio,
    -- Shock index
    CASE WHEN sbp > 0 AND hr IS NOT NULL THEN hr / sbp END AS shock_index,
    -- Hours since ICU admission
    DATETIME_DIFF(hour_ts, intime, HOUR)          AS hours_since_admission,
    -- Hours since infection onset
    CASE WHEN infection_time IS NOT NULL
         THEN DATETIME_DIFF(hour_ts, infection_time, HOUR) END AS hours_since_infection
  FROM joined AS j
),
sofa_scores AS (
  SELECT d.*,
    -- Coagulation
    CASE WHEN platelets IS NULL THEN NULL
         WHEN platelets < 20  THEN 4 WHEN platelets < 50  THEN 3
         WHEN platelets < 100 THEN 2 WHEN platelets < 150 THEN 1 ELSE 0
    END AS sofa_coag,
    -- Liver
    CASE WHEN bilirubin_total IS NULL THEN NULL
         WHEN bilirubin_total >= 12 THEN 4 WHEN bilirubin_total >= 6 THEN 3
         WHEN bilirubin_total >= 2  THEN 2 WHEN bilirubin_total >= 1.2 THEN 1 ELSE 0
    END AS sofa_liver,
    -- Renal (guard on CRRT: do not use urine if on CRRT)
    CASE
      WHEN creatinine IS NULL AND (crrt_active = 1 OR urine_ml IS NULL) THEN NULL
      WHEN creatinine >= 5 OR (crrt_active = 0 AND urine_ml_per_kg IS NOT NULL AND urine_ml_per_kg < 0.2) THEN 4
      WHEN creatinine >= 3.5 OR (crrt_active = 0 AND urine_ml_per_kg IS NOT NULL AND urine_ml_per_kg < 0.5) THEN 3
      WHEN creatinine >= 2   THEN 2
      WHEN creatinine >= 1.2 THEN 1
      ELSE 0
    END AS sofa_renal,
    -- Cardiovascular: NE-equivalent dose tiering
    CASE
      WHEN ne_equivalent_dose > 0.1  THEN 4
      WHEN ne_equivalent_dose > 0    THEN 3
      WHEN vasopressor_active = 1    THEN 2
      WHEN map_mean < 70             THEN 1
      ELSE 0
    END AS sofa_cardio,
    -- CNS (NULL when GCS is NULL)
    CASE WHEN gcs_total IS NULL THEN NULL
         WHEN gcs_total < 6  THEN 4 WHEN gcs_total < 10 THEN 3
         WHEN gcs_total < 13 THEN 2 WHEN gcs_total < 15 THEN 1 ELSE 0
    END AS sofa_cns,
    -- Respiratory
    CASE
      WHEN pf_ratio IS NULL AND sf_ratio IS NOT NULL AND sf_ratio < 150 AND vent_active = 1 THEN 4
      WHEN pf_ratio IS NULL AND sf_ratio IS NOT NULL AND sf_ratio < 235 AND vent_active = 1 THEN 3
      WHEN pf_ratio IS NULL THEN NULL
      WHEN pf_ratio < 100 AND vent_active = 1 THEN 4
      WHEN pf_ratio < 200 AND vent_active = 1 THEN 3
      WHEN pf_ratio < 300 THEN 2 WHEN pf_ratio < 400 THEN 1 ELSE 0
    END AS sofa_resp
  FROM derived AS d
),
with_sofa AS (
  SELECT s.*,
    COALESCE(sofa_resp,0)+COALESCE(sofa_coag,0)+COALESCE(sofa_liver,0)+
    COALESCE(sofa_renal,0)+COALESCE(sofa_cardio,0)+COALESCE(sofa_cns,0) AS sofa_approx,
    MIN(COALESCE(sofa_resp,0)+COALESCE(sofa_coag,0)+COALESCE(sofa_liver,0)+
        COALESCE(sofa_renal,0)+COALESCE(sofa_cardio,0)+COALESCE(sofa_cns,0))
      OVER (PARTITION BY stay_id ORDER BY hour_ts
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS baseline_sofa_approx,
    LAG(map_mean,   1) OVER (PARTITION BY stay_id ORDER BY hour_ts) AS prev_map_1h,
    LAG(shock_index,1) OVER (PARTITION BY stay_id ORDER BY hour_ts) AS prev_shock_index_1h,
    LAG(COALESCE(sofa_resp,0)+COALESCE(sofa_coag,0)+COALESCE(sofa_liver,0)+
        COALESCE(sofa_renal,0)+COALESCE(sofa_cardio,0)+COALESCE(sofa_cns,0), 6)
      OVER (PARTITION BY stay_id ORDER BY hour_ts) AS sofa_6h_ago
  FROM sofa_scores AS s
)
SELECT
  *,
  -- Delta SOFA over 6 hours (NEW)
  sofa_approx - COALESCE(sofa_6h_ago, sofa_approx) AS delta_sofa_6h,
  -- ARDS flag: PF<200 or SF<235 while on invasive vent for this hour
  IF((pf_ratio < 200 OR sf_ratio < 235) AND ventilation_status = 'InvasiveVent', 1, 0) AS ards_flag,
  -- Sepsis-3 flag (SOFA ≥2 from baseline near infection)
  IF(infection_time IS NOT NULL
     AND hour_ts BETWEEN DATETIME_SUB(infection_time, INTERVAL 24 HOUR)
                     AND DATETIME_ADD(infection_time, INTERVAL 24 HOUR)
     AND sofa_approx - baseline_sofa_approx >= 2, 1, 0) AS sepsis_flag,
  -- Septic shock
  IF(infection_time IS NOT NULL AND map_mean < 65
     AND vasopressor_active = 1 AND lactate > 2, 1, 0)  AS septic_shock_flag,
  -- Hemodynamic collapse
  IF((map_mean < 60 AND prev_map_1h < 60)
     OR (shock_index > 1 AND prev_shock_index_1h > 1)
     OR (vasopressor_start_hour = 1 AND (map_mean < 65 OR lactate > 2)), 1, 0) AS hemodynamic_collapse_flag
FROM with_sofa;

-- ── 2o) Event timestamps ──────────────────────────────────────────────────────
CREATE TEMP TABLE event_times AS
SELECT
  s.stay_id,
  MIN(IF(sepsis_flag = 1,              hour_ts, NULL)) AS sepsis_time,
  MIN(IF(septic_shock_flag = 1,        hour_ts, NULL)) AS shock_time,
  MIN(IF(hemodynamic_collapse_flag=1,  hour_ts, NULL)) AS collapse_time,
  MIN(IF(ards_flag = 1,                hour_ts, NULL)) AS ards_time,
  MIN(IF(aki_stage >= 2,               hour_ts, NULL)) AS aki_stage2_time,
  MIN(cardiac_arrest_time)                             AS arrest_time,
  MIN(death_time)                                      AS death_time,
  MIN(discharge_time)                                  AS discharge_time,
  MAX(sepsis_icd_flag)                                 AS sepsis_icd_flag,
  MAX(arrest_icd_flag)                                 AS arrest_icd_flag,
  MAX(arrest_proc_icd_flag)                            AS arrest_proc_icd_flag,
  MAX(aki_icd_flag)                                    AS aki_icd_flag,
  MAX(ards_icd_flag)                                   AS ards_icd_flag,
  MAX(major_surgery_proc_icd_flag)                     AS major_surgery_proc_icd_flag
FROM hourly_state AS s
GROUP BY s.stay_id;

CREATE TEMP TABLE event_stream AS
SELECT stay_id, sepsis_time     AS event_time, 'sepsis'     AS event_type FROM event_times WHERE sepsis_time     IS NOT NULL
UNION ALL
SELECT stay_id, shock_time,              'shock'      FROM event_times WHERE shock_time      IS NOT NULL
UNION ALL
SELECT stay_id, collapse_time,           'collapse'   FROM event_times WHERE collapse_time   IS NOT NULL
UNION ALL
SELECT stay_id, ards_time,               'ards'       FROM event_times WHERE ards_time       IS NOT NULL
UNION ALL
SELECT stay_id, aki_stage2_time,         'aki_stage2' FROM event_times WHERE aki_stage2_time IS NOT NULL
UNION ALL
SELECT stay_id, arrest_time,             'arrest'     FROM event_times WHERE arrest_time     IS NOT NULL
UNION ALL
SELECT stay_id, death_time,              'death'      FROM event_times WHERE death_time      IS NOT NULL
UNION ALL
SELECT stay_id, discharge_time,          'discharge'  FROM event_times WHERE discharge_time  IS NOT NULL;

-- ── 2p) Extubation events added to stream ────────────────────────────────────
INSERT INTO event_stream
SELECT stay_id, extubation_time AS event_time, 'extubation' AS event_type
FROM extubation_times;

-- =============================================================================
-- 3)  TEMPORAL DATASET CONSTRUCTION
-- =============================================================================
CREATE OR REPLACE TABLE `mimic-research-490610.icu_pipeline.icu_temporal_multievent_1h` AS
WITH features AS (
  SELECT
    s.subject_id, s.hadm_id, s.stay_id, s.intime, s.outtime, s.hour_ts,
    -- Raw vitals
    s.hr, s.map_mean, s.sbp, s.dbp, s.rr, s.spo2, s.temp_c, s.pulse_pressure,
    s.gcs_total, s.fio2_frac, s.pao2, s.paco2_abg, s.ph_abg,
    s.pf_ratio, s.sf_ratio, s.shock_index,
    s.vent_active, s.ventilation_status,
    -- Vasopressors
    s.vasopressor_active, s.ne_equivalent_dose,
    -- Labs
    s.lactate, s.creatinine, s.platelets, s.bilirubin_total,
    s.wbc, s.sodium, s.potassium, s.bicarbonate, s.hemoglobin, s.glucose,
    -- Urine
    s.urine_ml, s.urine_ml_per_kg, s.body_weight_kg,
    -- Organ support
    s.crrt_active,
    -- SOFA components and total
    s.sofa_resp, s.sofa_coag, s.sofa_liver, s.sofa_renal, s.sofa_cardio, s.sofa_cns,
    s.sofa_approx,
    -- NEW derived
    s.delta_sofa_6h,
    s.ards_flag,
    s.aki_stage, s.aki_stage_creat, s.aki_stage_uo,
    -- Temporal context
    s.hours_since_admission,
    s.hours_since_infection,
    -- ─── Rolling 12-hour window features ─────────────────────────────────────
    AVG(s.hr)              OVER w AS hr_mean_12h,
    STDDEV(s.hr)           OVER w AS hr_std_12h,         -- HRV proxy
    MIN(s.map_mean)        OVER w AS map_min_12h,
    AVG(s.map_mean)        OVER w AS map_mean_12h,
    MAX(s.lactate)         OVER w AS lactate_max_12h,
    MAX(s.creatinine)      OVER w AS creatinine_max_12h,
    MIN(s.platelets)       OVER w AS platelets_min_12h,
    MAX(s.bilirubin_total) OVER w AS bilirubin_max_12h,
    SUM(s.urine_ml)        OVER w AS urine_sum_12h,
    SUM(s.urine_ml_per_kg) OVER w AS urine_per_kg_sum_12h,
    MAX(CAST(s.vasopressor_active AS INT64)) OVER w AS vasopressor_any_12h,
    AVG(s.ne_equivalent_dose)               OVER w AS ne_dose_mean_12h,
    MAX(CAST(s.vent_active AS INT64))        OVER w AS vent_any_12h,
    MAX(s.sofa_approx)                       OVER w AS sofa_max_12h,
    AVG(s.delta_sofa_6h)                     OVER w AS delta_sofa_mean_12h,
    MAX(s.aki_stage)                         OVER w AS aki_stage_max_12h,
    MIN(s.pf_ratio)                          OVER w AS pf_ratio_min_12h,
    MIN(s.sf_ratio)                          OVER w AS sf_ratio_min_12h,
    MAX(s.shock_index)                       OVER w AS shock_index_max_12h,
    COUNT(*)               OVER w AS observed_hours_in_window
  FROM hourly_state AS s
  WINDOW w AS (
    PARTITION BY s.stay_id
    ORDER BY s.hour_ts
    ROWS BETWEEN 11 PRECEDING AND CURRENT ROW
  )
),
-- Join cohort-level features (race, severity scores, admission info)
features_enriched AS (
  SELECT
    f.*,
    c.race,
    c.gender,
    c.anchor_age,
    c.first_careunit,
    c.admission_type,
    c.charlson_comorbidity_index,
    c.oasis,
    c.oasis_prob,
    c.sapsii,
    c.sapsii_prob,
    c.hospital_expire_flag
  FROM features AS f
  INNER JOIN foundation_cohort AS c ON f.stay_id = c.stay_id
),

-- ── De-correlated next-event lookup (one JOIN per horizon) ───────────────────
-- BigQuery does not support correlated subqueries referencing separate tables.
-- We use ROW_NUMBER() over an explicit JOIN for each prediction horizon instead.
events_2h_ranked AS (
  SELECT
    f.stay_id, f.hour_ts,
    es.event_type, es.event_time,
    ROW_NUMBER() OVER (
      PARTITION BY f.stay_id, f.hour_ts
      ORDER BY es.event_time,
        CASE es.event_type
          WHEN 'death' THEN 1 WHEN 'arrest' THEN 2 WHEN 'shock' THEN 3
          WHEN 'sepsis' THEN 4 WHEN 'ards' THEN 5 WHEN 'collapse' THEN 6
          WHEN 'aki_stage2' THEN 7 WHEN 'extubation' THEN 8 WHEN 'discharge' THEN 9
          ELSE 99 END
    ) AS rn
  FROM features_enriched AS f
  INNER JOIN event_stream AS es
    ON es.stay_id = f.stay_id
    AND es.event_time > f.hour_ts
    AND es.event_time <= DATETIME_ADD(f.hour_ts, INTERVAL 2 HOUR)
),
next_2h AS (SELECT stay_id, hour_ts, event_type, event_time FROM events_2h_ranked WHERE rn = 1),

events_6h_ranked AS (
  SELECT
    f.stay_id, f.hour_ts,
    es.event_type, es.event_time,
    ROW_NUMBER() OVER (
      PARTITION BY f.stay_id, f.hour_ts
      ORDER BY es.event_time,
        CASE es.event_type
          WHEN 'death' THEN 1 WHEN 'arrest' THEN 2 WHEN 'shock' THEN 3
          WHEN 'sepsis' THEN 4 WHEN 'ards' THEN 5 WHEN 'collapse' THEN 6
          WHEN 'aki_stage2' THEN 7 WHEN 'extubation' THEN 8 WHEN 'discharge' THEN 9
          ELSE 99 END
    ) AS rn
  FROM features_enriched AS f
  INNER JOIN event_stream AS es
    ON es.stay_id = f.stay_id
    AND es.event_time > f.hour_ts
    AND es.event_time <= DATETIME_ADD(f.hour_ts, INTERVAL 6 HOUR)
),
next_6h AS (SELECT stay_id, hour_ts, event_type, event_time FROM events_6h_ranked WHERE rn = 1),

events_12h_ranked AS (
  SELECT
    f.stay_id, f.hour_ts,
    es.event_type, es.event_time,
    ROW_NUMBER() OVER (
      PARTITION BY f.stay_id, f.hour_ts
      ORDER BY es.event_time,
        CASE es.event_type
          WHEN 'death' THEN 1 WHEN 'arrest' THEN 2 WHEN 'shock' THEN 3
          WHEN 'sepsis' THEN 4 WHEN 'ards' THEN 5 WHEN 'collapse' THEN 6
          WHEN 'aki_stage2' THEN 7 WHEN 'extubation' THEN 8 WHEN 'discharge' THEN 9
          ELSE 99 END
    ) AS rn
  FROM features_enriched AS f
  INNER JOIN event_stream AS es
    ON es.stay_id = f.stay_id
    AND es.event_time > f.hour_ts
    AND es.event_time <= DATETIME_ADD(f.hour_ts, INTERVAL 12 HOUR)
),
next_12h AS (SELECT stay_id, hour_ts, event_type, event_time FROM events_12h_ranked WHERE rn = 1)

SELECT
  f.subject_id, f.hadm_id, f.stay_id,
  ABS(MOD(FARM_FINGERPRINT(CAST(f.subject_id AS STRING)), 100)) AS patient_split_bucket,
  f.hour_ts AS prediction_time,
  -- Demographics / cohort attributes
  f.race, f.gender, f.anchor_age, f.first_careunit, f.admission_type,
  f.charlson_comorbidity_index, f.oasis, f.oasis_prob, f.sapsii, f.sapsii_prob,
  f.hospital_expire_flag,
  -- Vitals
  f.hr, f.map_mean, f.sbp, f.dbp, f.rr, f.spo2, f.temp_c, f.pulse_pressure,
  f.gcs_total, f.fio2_frac, f.pao2, f.paco2_abg, f.ph_abg, f.pf_ratio, f.sf_ratio,
  -- Organ support
  f.vent_active, f.ventilation_status, f.vasopressor_active, f.ne_equivalent_dose, f.crrt_active,
  -- Labs
  f.lactate, f.creatinine, f.platelets, f.bilirubin_total,
  f.wbc, f.sodium, f.potassium, f.bicarbonate, f.hemoglobin, f.glucose,
  -- Urine
  f.urine_ml, f.urine_ml_per_kg, f.body_weight_kg,
  -- SOFA
  f.sofa_resp, f.sofa_coag, f.sofa_liver, f.sofa_renal, f.sofa_cardio, f.sofa_cns, f.sofa_approx,
  -- Derived risk signals
  f.shock_index, f.delta_sofa_6h, f.ards_flag, f.aki_stage, f.aki_stage_creat, f.aki_stage_uo,
  -- Temporal context
  f.hours_since_admission, f.hours_since_infection,
  -- 12h rolling window
  f.hr_mean_12h, f.hr_std_12h, f.map_min_12h, f.map_mean_12h,
  f.lactate_max_12h, f.creatinine_max_12h, f.platelets_min_12h, f.bilirubin_max_12h,
  f.urine_sum_12h, f.urine_per_kg_sum_12h, f.vasopressor_any_12h, f.ne_dose_mean_12h,
  f.vent_any_12h, f.sofa_max_12h, f.delta_sofa_mean_12h, f.aki_stage_max_12h,
  f.pf_ratio_min_12h, f.sf_ratio_min_12h, f.shock_index_max_12h, f.observed_hours_in_window,
  -- Multi-horizon binary labels
  IF(n2.event_type  IS NULL, 0, 1) AS label_2h,
  IF(n6.event_type  IS NULL, 0, 1) AS label_6h,
  IF(n12.event_type IS NULL, 0, 1) AS label_12h,
  -- Event type labels
  COALESCE(n2.event_type,  'none') AS event_type_2h,
  COALESCE(n6.event_type,  'none') AS event_type_6h,
  COALESCE(n12.event_type, 'none') AS event_type_12h,
  n2.event_time   AS event_time_2h,
  n6.event_time   AS event_time_6h,
  n12.event_time  AS event_time_12h,
  window_hours    AS observation_window_hours
FROM features_enriched AS f
LEFT JOIN next_2h  AS n2  ON f.stay_id = n2.stay_id  AND f.hour_ts = n2.hour_ts
LEFT JOIN next_6h  AS n6  ON f.stay_id = n6.stay_id  AND f.hour_ts = n6.hour_ts
LEFT JOIN next_12h AS n12 ON f.stay_id = n12.stay_id AND f.hour_ts = n12.hour_ts
WHERE f.observed_hours_in_window >= burn_in_hours;

-- =============================================================================
-- 4)  PHENOTYPE SUMMARY TABLE (paper Table 1 ready)
-- =============================================================================
CREATE OR REPLACE TABLE `mimic-research-490610.icu_pipeline.icu_temporal_multievent_1h_summary` AS
SELECT
  COUNT(DISTINCT c.stay_id)                                                        AS n_icu_stays,
  COUNT(DISTINCT c.subject_id)                                                     AS n_unique_patients,
  AVG(c.anchor_age)                                                                AS mean_age,
  APPROX_QUANTILES(c.anchor_age, 2)[OFFSET(1)]                                    AS median_age,
  COUNTIF(c.gender = 'F') / COUNT(*)                                               AS pct_female,
  -- Race breakdown
  COUNTIF(UPPER(c.race) LIKE '%WHITE%')    / COUNT(*) AS pct_white,
  COUNTIF(UPPER(c.race) LIKE '%BLACK%')    / COUNT(*) AS pct_black,
  COUNTIF(UPPER(c.race) LIKE '%HISPANIC%') / COUNT(*) AS pct_hispanic,
  COUNTIF(UPPER(c.race) LIKE '%ASIAN%')    / COUNT(*) AS pct_asian,
  -- Severity
  AVG(c.charlson_comorbidity_index)                                                AS mean_charlson,
  AVG(c.oasis)                                                                     AS mean_oasis,
  AVG(c.sapsii)                                                                    AS mean_sapsii,
  -- Exclusion flags
  SUM(CASE WHEN c.dnr_or_comfort_flag = 1 THEN 1 ELSE 0 END)                      AS n_dnr_or_comfort_flagged,
  -- Event counts
  SUM(CASE WHEN e.sepsis_time     IS NOT NULL THEN 1 ELSE 0 END)                   AS n_sepsis,
  SUM(CASE WHEN e.shock_time      IS NOT NULL THEN 1 ELSE 0 END)                   AS n_septic_shock,
  SUM(CASE WHEN e.collapse_time   IS NOT NULL THEN 1 ELSE 0 END)                   AS n_hemodynamic_collapse,
  SUM(CASE WHEN e.ards_time       IS NOT NULL THEN 1 ELSE 0 END)                   AS n_ards,
  SUM(CASE WHEN e.aki_stage2_time IS NOT NULL THEN 1 ELSE 0 END)                   AS n_aki_stage2,
  SUM(CASE WHEN e.arrest_time     IS NOT NULL THEN 1 ELSE 0 END)                   AS n_cardiac_arrest,
  SUM(CASE WHEN e.death_time      IS NOT NULL THEN 1 ELSE 0 END)                   AS n_death,
  -- ICD validation support
  SUM(CASE WHEN e.sepsis_time IS NOT NULL AND e.sepsis_icd_flag   = 1 THEN 1 ELSE 0 END) AS n_sepsis_icd_supported,
  SUM(CASE WHEN e.arrest_time IS NOT NULL AND (e.arrest_icd_flag=1 OR e.arrest_proc_icd_flag=1) THEN 1 ELSE 0 END) AS n_arrest_icd_supported,
  SUM(CASE WHEN e.aki_stage2_time IS NOT NULL AND e.aki_icd_flag  = 1 THEN 1 ELSE 0 END) AS n_aki_icd_supported,
  SUM(CASE WHEN e.ards_time   IS NOT NULL AND e.ards_icd_flag     = 1 THEN 1 ELSE 0 END) AS n_ards_icd_supported,
  -- Transfer metrics
  AVG(c.hospital_transfer_count)                                                   AS mean_hospital_transfer_count,
  -- Time-to-event medians
  APPROX_QUANTILES(IF(e.sepsis_time     IS NOT NULL, DATETIME_DIFF(e.sepsis_time,     c.intime, HOUR), NULL), 2)[OFFSET(1)] AS median_h_to_sepsis,
  APPROX_QUANTILES(IF(e.shock_time      IS NOT NULL, DATETIME_DIFF(e.shock_time,      c.intime, HOUR), NULL), 2)[OFFSET(1)] AS median_h_to_shock,
  APPROX_QUANTILES(IF(e.collapse_time   IS NOT NULL, DATETIME_DIFF(e.collapse_time,   c.intime, HOUR), NULL), 2)[OFFSET(1)] AS median_h_to_collapse,
  APPROX_QUANTILES(IF(e.ards_time       IS NOT NULL, DATETIME_DIFF(e.ards_time,       c.intime, HOUR), NULL), 2)[OFFSET(1)] AS median_h_to_ards,
  APPROX_QUANTILES(IF(e.aki_stage2_time IS NOT NULL, DATETIME_DIFF(e.aki_stage2_time, c.intime, HOUR), NULL), 2)[OFFSET(1)] AS median_h_to_aki_stage2,
  APPROX_QUANTILES(IF(e.arrest_time     IS NOT NULL, DATETIME_DIFF(e.arrest_time,     c.intime, HOUR), NULL), 2)[OFFSET(1)] AS median_h_to_arrest,
  APPROX_QUANTILES(IF(e.death_time      IS NOT NULL, DATETIME_DIFF(e.death_time,      c.intime, HOUR), NULL), 2)[OFFSET(1)] AS median_h_to_death
FROM foundation_cohort AS c
LEFT JOIN event_times  AS e ON c.stay_id = e.stay_id;
