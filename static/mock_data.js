/* ================================================================
   Mock Data — based on real governance data from
   life-sciences-demo.domino-eval.com

   Whitelabel: bundle → "deliverable", policy → "QC plan"
   ================================================================ */

var MOCK_TERMINOLOGY = {
  bundle: 'Deliverable',
  policy: 'QC Plan',
};

// Real users from the demo instance
var MOCK_USERS = {
  agnes:     { id: '69160c9da4464d12be7f6e84', name: 'agnes_domino', firstName: 'Agnes', lastName: 'Youn' },
  ross:      { id: '690a96caa4464d12be7f6e83', name: 'ross_domino', firstName: 'Ross', lastName: 'Sharp' },
  etan:      { id: '6972a494aa27113e76bd1c6c', name: 'etan_domino', firstName: 'Etan', lastName: 'Lightstone' },
  studyLead: { id: '6926323aa4464d12be7f6e87', name: 'study_lead', firstName: 'Study', lastName: 'Lead' },
  qcProg:    { id: '6966cdf424fcea6bf65ad4f5', name: 'qc_programmer', firstName: 'QC', lastName: 'Programmer' },
  prodProg:  { id: '6926318da4464d12be7f6e86', name: 'production_programmer', firstName: 'Production', lastName: 'Programmer' },
};

// Real policy structures from the demo
var MOCK_POLICIES = [
  {
    id: 'cc759cd8-4ac5-4d1c-8f57-d79023ec0526',
    name: 'ADaM QC Plan - High Risk',
    status: 'Published',
    stages: ['Self QC', 'Double Programming', 'Study Lead Verification'],
  },
  {
    id: 'e9d62ce6-3733-42f2-a670-7a9820ec5ae8',
    name: 'ADaM QC Plan - Low Risk',
    status: 'Published',
    stages: ['Self QC', 'Study Lead Verification'],
  },
  {
    id: 'd6cc41b7-f44c-4237-aa3d-c5e77ab92e5f',
    name: 'TFL QC Plan - High Risk',
    status: 'Published',
    stages: ['Self QC', 'Double Programming', 'Study Lead Verification'],
  },
  {
    id: 'f1a2b3c4-d5e6-7890-abcd-ef1234567890',
    name: 'TFL QC Plan - Low Risk',
    status: 'Published',
    stages: ['Self QC', 'Study Lead Verification'],
  },
  {
    id: '312afe51-6f95-4e2b-aec5-cbd631560afb',
    name: 'RWE Regulatory Submission Policy',
    status: 'Published',
    stages: [
      'Study Registration and Protocol Lock',
      'Data Assets and OMOP Governance',
      'Cohort Definition and Reproducibility',
      'Pipeline Execution and Environment Lock',
      'Statistical Analysis and Results Review',
      'Submission Package and Regulatory Release',
    ],
  },
  {
    id: '94d5f81f-644b-4b53-a9e8-133c0dea42ab',
    name: 'Surgical AI Governance QC Plan',
    status: 'Published',
    stages: [
      'Model Initiation and Intended Use Declaration',
      'Data Governance and Feature Engineering Review',
      'Training Pipeline and Reproducibility Audit',
      'Clinical Validation and Safety Review',
      'Regulatory Documentation and Submission Readiness',
      'Post-Market Monitoring and Continuous Evaluation',
    ],
  },
  {
    id: '3bcdec29-6c9f-4826-bee2-e17a166ae719',
    name: 'Data Access Request & Approval Policy',
    status: 'Published',
    stages: [
      'Access Request Intake',
      'Contract & Restriction Check',
      'Legal & Privacy Review',
      'Access Provisioning',
      'Post-Access Monitoring',
    ],
  },
];

// Helper to make a stage object
function makeStages(policyStages) {
  return policyStages.map(function(name, idx) {
    return {
      stage: { name: name, order: idx },
      stageId: 'stage-' + idx,
      assignee: null,
      assignedAt: null,
    };
  });
}

// Helper to make a createdBy object
function makeCreatedBy(user) {
  return { id: user.id, firstName: user.firstName, lastName: user.lastName, userName: user.name };
}

// ── Project Tags (mirrors Domino project tag taxonomy) ──────────
var MOCK_PROJECT_TAGS = {
  'proj-cdiscpilot': [
    { key: 'Therapeutic-Area', value: 'Oncology / Lung-Cancer / nsclc' },
    { key: 'Clinical-Phase', value: 'Phase-2' },
    { key: 'Drug-Compound', value: 'Compound-127' },
    { key: 'Team', value: 'AI-Drug-Discovery' },
    { key: 'Project-Status', value: 'Active' },
    { key: 'Data-Quality', value: 'Curated' },
    { key: 'Organism', value: 'Human' },
    { key: 'Technique', value: 'Genomic-Sequencing / RNA-Seq' },
  ],
  'proj-rwe-migraine': [
    { key: 'Therapeutic-Area', value: 'Neurology / Migraine' },
    { key: 'Clinical-Phase', value: 'Post-Marketing' },
    { key: 'Drug-Compound', value: 'Erenumab' },
    { key: 'Team', value: 'RWE-Analytics' },
    { key: 'Project-Status', value: 'Active' },
    { key: 'Data-Quality', value: 'Raw' },
    { key: 'Technique', value: 'RWE / Claims-Analysis' },
  ],
  'proj-surgical-ai': [
    { key: 'Therapeutic-Area', value: 'Surgery / Robotic-Assisted' },
    { key: 'Clinical-Phase', value: 'Pre-Market' },
    { key: 'Team', value: 'Medical-Device-AI' },
    { key: 'Project-Status', value: 'Active' },
    { key: 'Data-Quality', value: 'Curated' },
    { key: 'Technique', value: 'Computer-Vision / Deep-Learning' },
  ],
  'proj-data-access': [
    { key: 'Team', value: 'Data-Governance' },
    { key: 'Project-Status', value: 'Active' },
    { key: 'Data-Quality', value: 'Mixed' },
  ],
};

// ── Bundles (Deliverables) ──────────────────────────────────────
var MOCK_BUNDLES = [
  // ADaM deliverables — various states
  {
    id: 'b-adsl-001', name: 'ADSL Dataset', state: 'Complete',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[0].id, policyName: MOCK_POLICIES[0].name,
    stage: 'Study Lead Verification',
    stages: makeStages(MOCK_POLICIES[0].stages),
    stageAssignee: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
    commentsCount: 4,
    createdAt: '2026-01-15T09:00:00Z', updatedAt: '2026-02-28T14:30:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.ross),
  },
  {
    id: 'b-adae-002', name: 'ADAE Dataset', state: 'Complete',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[0].id, policyName: MOCK_POLICIES[0].name,
    stage: 'Study Lead Verification',
    stages: makeStages(MOCK_POLICIES[0].stages),
    stageAssignee: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
    commentsCount: 6,
    createdAt: '2026-01-20T10:00:00Z', updatedAt: '2026-03-05T11:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.ross),
  },
  {
    id: 'b-adcm-003', name: 'ADCM Dataset', state: 'Complete',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[0].id, policyName: MOCK_POLICIES[0].name,
    stage: 'Study Lead Verification',
    stages: makeStages(MOCK_POLICIES[0].stages),
    stageAssignee: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
    commentsCount: 2,
    createdAt: '2026-01-22T08:00:00Z', updatedAt: '2026-03-01T16:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.prodProg),
  },
  {
    id: 'b-adlb-004', name: 'ADLB Dataset', state: 'Active',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[1].id, policyName: MOCK_POLICIES[1].name,
    stage: 'Study Lead Verification',
    stages: makeStages(MOCK_POLICIES[1].stages),
    stageAssignee: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
    commentsCount: 1,
    createdAt: '2026-02-01T09:00:00Z', updatedAt: '2026-03-18T10:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.prodProg),
  },
  {
    id: 'b-advs-005', name: 'ADVS Dataset', state: 'Active',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[1].id, policyName: MOCK_POLICIES[1].name,
    stage: 'Study Lead Verification',
    stages: makeStages(MOCK_POLICIES[1].stages),
    stageAssignee: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
    commentsCount: 0,
    createdAt: '2026-02-05T09:00:00Z', updatedAt: '2026-03-19T09:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.prodProg),
  },
  {
    id: 'b-admh-006', name: 'ADMH Dataset', state: 'Active',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[1].id, policyName: MOCK_POLICIES[1].name,
    stage: 'Study Lead Verification',
    stages: makeStages(MOCK_POLICIES[1].stages),
    stageAssignee: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
    commentsCount: 0,
    createdAt: '2026-02-10T09:00:00Z', updatedAt: '2026-03-20T09:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.prodProg),
  },
  // ADaM in-progress
  {
    id: 'b-adae-active-007', name: 'ADAE Output Verification', state: 'Active',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[0].id, policyName: MOCK_POLICIES[0].name,
    stage: 'Double Programming',
    stages: makeStages(MOCK_POLICIES[0].stages),
    stageAssignee: { id: MOCK_USERS.qcProg.id, name: 'qc_programmer' },
    commentsCount: 3,
    createdAt: '2026-02-20T10:00:00Z', updatedAt: '2026-03-22T15:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.ross),
  },
  // TFL deliverables
  {
    id: 'b-tpop-008', name: 'T_POP Output', state: 'Complete',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[2].id, policyName: MOCK_POLICIES[2].name,
    stage: 'Study Lead Verification',
    stages: makeStages(MOCK_POLICIES[2].stages),
    stageAssignee: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
    commentsCount: 5,
    createdAt: '2026-02-01T11:00:00Z', updatedAt: '2026-03-10T09:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.etan),
  },
  {
    id: 'b-tvscat-009', name: 'T_VSCAT Output', state: 'Active',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[3].id, policyName: MOCK_POLICIES[3].name,
    stage: 'Study Lead Verification',
    stages: makeStages(MOCK_POLICIES[3].stages),
    stageAssignee: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
    commentsCount: 2,
    createdAt: '2026-02-15T11:00:00Z', updatedAt: '2026-03-21T10:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.etan),
  },
  {
    id: 'b-taerel-010', name: 'T_AE_REL Output', state: 'Active',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[2].id, policyName: MOCK_POLICIES[2].name,
    stage: 'Double Programming',
    stages: makeStages(MOCK_POLICIES[2].stages),
    stageAssignee: { id: MOCK_USERS.qcProg.id, name: 'qc_programmer' },
    commentsCount: 1,
    createdAt: '2026-02-25T11:00:00Z', updatedAt: '2026-03-23T14:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.etan),
  },
  // RWE deliverable (multi-stage, early)
  {
    id: 'b-rwe-011', name: 'Migraine RWE Regulatory Submission', state: 'Active',
    projectId: 'proj-rwe-migraine', projectName: 'Scalable_RWE_Migraine',
    projectOwner: 'agnes_domino',
    policyId: MOCK_POLICIES[4].id, policyName: MOCK_POLICIES[4].name,
    stage: 'Study Registration and Protocol Lock',
    stages: makeStages(MOCK_POLICIES[4].stages),
    stageAssignee: { id: MOCK_USERS.agnes.id, name: 'agnes_domino' },
    commentsCount: 8,
    createdAt: '2026-03-23T01:53:22Z', updatedAt: '2026-03-25T10:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.agnes),
  },
  // Surgical AI deliverable
  {
    id: 'b-surg-012', name: 'Surgical AI Governance Feb 2026', state: 'Active',
    projectId: 'proj-surgical-ai', projectName: 'Surgical_AI_Validation',
    projectOwner: 'agnes_domino',
    policyId: MOCK_POLICIES[5].id, policyName: MOCK_POLICIES[5].name,
    stage: 'Model Initiation and Intended Use Declaration',
    stages: makeStages(MOCK_POLICIES[5].stages),
    stageAssignee: { id: MOCK_USERS.agnes.id, name: 'agnes_domino' },
    commentsCount: 3,
    createdAt: '2026-02-18T14:00:00Z', updatedAt: '2026-03-24T09:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.agnes),
  },
  // Data Access deliverable
  {
    id: 'b-daccess-013', name: 'Data Access Request Feb 2026', state: 'Active',
    projectId: 'proj-data-access', projectName: 'Data_Governance_Central',
    projectOwner: 'etan_domino',
    policyId: MOCK_POLICIES[6].id, policyName: MOCK_POLICIES[6].name,
    stage: 'Legal & Privacy Review',
    stages: makeStages(MOCK_POLICIES[6].stages),
    stageAssignee: { id: MOCK_USERS.etan.id, name: 'etan_domino' },
    commentsCount: 5,
    createdAt: '2026-02-08T10:00:00Z', updatedAt: '2026-03-22T16:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.etan),
  },
  // Early stage self-QC
  {
    id: 'b-adex-014', name: 'ADEX Dataset', state: 'Active',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[0].id, policyName: MOCK_POLICIES[0].name,
    stage: 'Self QC',
    stages: makeStages(MOCK_POLICIES[0].stages),
    stageAssignee: { id: MOCK_USERS.prodProg.id, name: 'production_programmer' },
    commentsCount: 0,
    createdAt: '2026-03-15T09:00:00Z', updatedAt: '2026-03-24T11:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.prodProg),
  },
  // Archived
  {
    id: 'b-adlb-arch-015', name: 'ADLB (Superseded)', state: 'Archived',
    projectId: 'proj-cdiscpilot', projectName: 'CDISC_Pilot_Study_01',
    projectOwner: 'ross_domino',
    policyId: MOCK_POLICIES[1].id, policyName: MOCK_POLICIES[1].name,
    stage: 'Self QC',
    stages: makeStages(MOCK_POLICIES[1].stages),
    stageAssignee: { id: '', name: '' },
    commentsCount: 1,
    createdAt: '2026-01-05T09:00:00Z', updatedAt: '2026-02-01T09:00:00Z',
    createdBy: makeCreatedBy(MOCK_USERS.prodProg),
  },
];

// ── Approvals ───────────────────────────────────────────────────
var MOCK_APPROVALS = {
  'b-adsl-001': [
    { id: 'a-001', name: 'Study lead verification and approvals', bundleId: 'b-adsl-001', status: 'Approved',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-02-28T14:30:00Z', updatedBy: 'study_lead' },
  ],
  'b-adae-002': [
    { id: 'a-002', name: 'Study lead verification and approvals', bundleId: 'b-adae-002', status: 'Approved',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-05T11:00:00Z', updatedBy: 'study_lead' },
  ],
  'b-adcm-003': [
    { id: 'a-003', name: 'Study lead verification and approvals', bundleId: 'b-adcm-003', status: 'Approved',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-01T16:00:00Z', updatedBy: 'study_lead' },
  ],
  'b-adlb-004': [
    { id: 'a-004', name: 'Study lead verification and approvals', bundleId: 'b-adlb-004', status: 'PendingReview',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-18T10:00:00Z', updatedBy: 'production_programmer' },
  ],
  'b-advs-005': [
    { id: 'a-005', name: 'Study lead verification and approvals', bundleId: 'b-advs-005', status: 'PendingReview',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-19T09:00:00Z', updatedBy: 'production_programmer' },
  ],
  'b-admh-006': [
    { id: 'a-006', name: 'Study lead verification and approvals', bundleId: 'b-admh-006', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-20T09:00:00Z', updatedBy: 'production_programmer' },
  ],
  'b-adae-active-007': [
    { id: 'a-007', name: 'Study lead verification and approvals', bundleId: 'b-adae-active-007', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-22T15:00:00Z', updatedBy: 'qc_programmer' },
  ],
  'b-tpop-008': [
    { id: 'a-008', name: 'Study lead verification and approvals', bundleId: 'b-tpop-008', status: 'Approved',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-10T09:00:00Z', updatedBy: 'study_lead' },
  ],
  'b-tvscat-009': [
    { id: 'a-009', name: 'Study lead verification and approvals', bundleId: 'b-tvscat-009', status: 'PendingReview',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-21T10:00:00Z', updatedBy: 'etan_domino' },
  ],
  'b-taerel-010': [
    { id: 'a-010', name: 'Study lead verification and approvals', bundleId: 'b-taerel-010', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-23T14:00:00Z', updatedBy: 'etan_domino' },
  ],
  'b-rwe-011': [
    { id: 'a-011a', name: 'Protocol Lock Sign-Off', bundleId: 'b-rwe-011', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }],
      updatedAt: '2026-03-25T10:00:00Z' },
    { id: 'a-011b', name: 'Data Governance Sign-Off', bundleId: 'b-rwe-011', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
    { id: 'a-011c', name: 'Cohort Logic Sign-Off', bundleId: 'b-rwe-011', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
    { id: 'a-011d', name: 'Pipeline Execution Sign-Off', bundleId: 'b-rwe-011', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
    { id: 'a-011e', name: 'Statistical Analysis Sign-Off', bundleId: 'b-rwe-011', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
    { id: 'a-011f', name: 'Regulatory Affairs Sign-Off', bundleId: 'b-rwe-011', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
    { id: 'a-011g', name: 'Executive Release Authorization', bundleId: 'b-rwe-011', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
  ],
  'b-surg-012': [
    { id: 'a-012a', name: 'Intended Use Declaration Review', bundleId: 'b-surg-012', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }] },
    { id: 'a-012b', name: 'Clinical Validation Review', bundleId: 'b-surg-012', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }] },
  ],
  'b-daccess-013': [
    { id: 'a-013', name: 'Legal & Privacy Sign-Off', bundleId: 'b-daccess-013', status: 'ConditionallyApproved',
      approvers: [{ id: MOCK_USERS.etan.id, name: 'etan_domino' }],
      updatedAt: '2026-03-22T16:00:00Z' },
  ],
  'b-adex-014': [
    { id: 'a-014', name: 'Study lead verification and approvals', bundleId: 'b-adex-014', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead' }],
      updatedAt: '2026-03-24T11:00:00Z' },
  ],
};

// ── Findings ────────────────────────────────────────────────────
var MOCK_FINDINGS = {
  'b-adae-active-007': [
    {
      id: 'f-001', name: 'AE onset date discrepancy with SDTM.AE',
      bundleId: 'b-adae-active-007', severity: 'S1', status: 'InProgress',
      description: 'ADAE.ASTDT does not match expected derivation from AE.AESTDTC for 3 subjects',
      assignee: { id: MOCK_USERS.qcProg.id, name: 'qc_programmer' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: '2026-03-28T00:00:00Z',
      createdAt: '2026-03-20T10:00:00Z', updatedAt: '2026-03-22T15:00:00Z',
    },
    {
      id: 'f-002', name: 'Missing AEBODSYS for preferred term mapping',
      bundleId: 'b-adae-active-007', severity: 'S2', status: 'ToDo',
      description: 'Body system organ class not populated for 12 records where AEDECOD is present',
      assignee: { id: MOCK_USERS.prodProg.id, name: 'production_programmer' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: '2026-03-30T00:00:00Z',
      createdAt: '2026-03-21T14:00:00Z', updatedAt: '2026-03-21T14:00:00Z',
    },
  ],
  'b-taerel-010': [
    {
      id: 'f-003', name: 'Related AE count mismatch vs source TLF spec',
      bundleId: 'b-taerel-010', severity: 'S2', status: 'InReview',
      description: 'Output row counts for treatment-related AEs differ from SAP Table 14.3.1 specification',
      assignee: { id: MOCK_USERS.etan.id, name: 'etan_domino' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: '2026-03-26T00:00:00Z',
      createdAt: '2026-03-18T09:00:00Z', updatedAt: '2026-03-23T11:00:00Z',
    },
  ],
  'b-tpop-008': [
    {
      id: 'f-004', name: 'Population flag derivation logic correction',
      bundleId: 'b-tpop-008', severity: 'S1', status: 'Done',
      description: 'Safety population flag was incorrectly excluding screen failures who received partial dose',
      assignee: { id: MOCK_USERS.etan.id, name: 'etan_domino' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: '2026-03-05T00:00:00Z',
      createdAt: '2026-02-20T10:00:00Z', updatedAt: '2026-03-04T16:00:00Z',
    },
  ],
  'b-adlb-004': [
    {
      id: 'f-005', name: 'Baseline flag derivation uses wrong visit window',
      bundleId: 'b-adlb-004', severity: 'S0', status: 'InProgress',
      description: 'ABLFL set to Y for Visit 2 instead of last non-missing pre-dose value per SAP',
      assignee: { id: MOCK_USERS.prodProg.id, name: 'production_programmer' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: '2026-03-25T00:00:00Z',
      createdAt: '2026-03-15T11:00:00Z', updatedAt: '2026-03-23T09:00:00Z',
    },
    {
      id: 'f-006', name: 'PARAMCD truncation for long lab parameter names',
      bundleId: 'b-adlb-004', severity: 'S3', status: 'ToDo',
      description: 'Several PARAMCD values exceed 8 characters, violating ADaM IG constraint',
      assignee: { id: MOCK_USERS.prodProg.id, name: 'production_programmer' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: null,
      createdAt: '2026-03-17T14:00:00Z', updatedAt: '2026-03-17T14:00:00Z',
    },
  ],
  'b-rwe-011': [
    {
      id: 'f-007', name: 'OMOP CDM vocabulary version mismatch across sites',
      bundleId: 'b-rwe-011', severity: 'S1', status: 'ToDo',
      description: 'Site A uses OMOP v5.3 while Site B uses v5.4 — condition concept mappings may diverge',
      assignee: { id: MOCK_USERS.agnes.id, name: 'agnes_domino' },
      approver: { id: MOCK_USERS.agnes.id, name: 'agnes_domino' },
      dueDate: '2026-04-01T00:00:00Z',
      createdAt: '2026-03-24T09:00:00Z', updatedAt: '2026-03-24T09:00:00Z',
    },
  ],
};

// ── Gates ────────────────────────────────────────────────────────
var MOCK_GATES = {
  'b-rwe-011': [
    { id: 'g-001', name: 'Submission Package Release Gate', bundleId: 'b-rwe-011', isOpen: false, reason: 'All stage approvals must be complete' },
    { id: 'g-002', name: 'IRQ Response Authorization Gate', bundleId: 'b-rwe-011', isOpen: false, reason: 'Pending regulatory query response' },
  ],
  'b-surg-012': [
    { id: 'g-003', name: 'Clinical Safety Release Gate', bundleId: 'b-surg-012', isOpen: false, reason: 'Clinical validation not yet started' },
  ],
};
