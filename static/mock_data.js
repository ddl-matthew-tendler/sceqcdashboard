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

// Project members — used for stage assignment dropdowns
// In production, fetched via GET /v4/projects/{projectId}/collaborators
var MOCK_PROJECT_MEMBERS = Object.keys(MOCK_USERS).map(function(key) {
  var u = MOCK_USERS[key];
  return { id: u.id, userName: u.name, firstName: u.firstName, lastName: u.lastName };
});

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
      'Data Assets and OMOP Review',
      'Cohort Definition and Reproducibility',
      'Pipeline Execution and Environment Lock',
      'Statistical Analysis and Results Review',
      'Submission Package and Regulatory Release',
    ],
  },
  {
    id: '94d5f81f-644b-4b53-a9e8-133c0dea42ab',
    name: 'Surgical AI QC Plan',
    status: 'Published',
    stages: [
      'Model Initiation and Intended Use Declaration',
      'Data Quality and Feature Engineering Review',
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
    { key: 'Team', value: 'Data-Quality' },
    { key: 'Project-Status', value: 'Active' },
    { key: 'Data-Quality', value: 'Mixed' },
  ],
};

// ── Bundles (Deliverables) ──────────────────────────────────────
var MOCK_BUNDLES = [
  // ADaM deliverables — various states
  {
    id: '056cae0c-b450-4cc1-beb6-54f49188ba89', name: 'ADSL Dataset', state: 'Complete',
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
    id: 'ed04e23a-a31b-42c7-a093-6c1ce8b195a0', name: 'ADAE Dataset', state: 'Complete',
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
    id: 'e013152a-c32c-4b2e-ba22-2fb1aff3fadc', name: 'ADCM Dataset', state: 'Complete',
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
    id: '606518ef-9487-4115-861b-5714cbcb55d0', name: 'ADLB Dataset', state: 'Active',
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
    id: 'ab8d6b10-4d0d-43c7-a0a7-5bb03acde779', name: 'ADVS Dataset', state: 'Active',
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
    id: 'd671b9ac-a496-403a-9028-d3d6326d2fe8', name: 'ADMH Dataset', state: 'Active',
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
    id: '8b5b6810-7ad1-498d-8684-2756c3dfd595', name: 'ADAE Output Verification', state: 'Active',
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
    id: '7be21d96-7d50-42a8-9de8-95ddbc319b86', name: 'T_POP Output', state: 'Complete',
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
    id: '37eaa72c-1ce0-4d35-9e94-2bcb894fc671', name: 'T_VSCAT Output', state: 'Active',
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
    id: '1e33a98f-0b9e-4dc0-af12-5d9d63736ba2', name: 'T_AE_REL Output', state: 'Active',
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
    id: '8813c744-6a8a-436d-aa20-68e072d3f829', name: 'Migraine RWE Regulatory Submission', state: 'Active',
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
    id: 'a084c730-c66f-43a3-aaee-2cefbbc66ca1', name: 'Surgical AI Validation Feb 2026', state: 'Active',
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
    id: '15ec424a-0dca-4d91-b9fe-4bf2c7e3a673', name: 'Data Access Request Feb 2026', state: 'Active',
    projectId: 'proj-data-access', projectName: 'Data_Quality_Central',
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
    id: '324e6b2c-dd55-483d-bbd4-89d82a941a32', name: 'ADEX Dataset', state: 'Active',
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
    id: '7fcf6fda-590a-40cf-acdf-3e6193343534', name: 'ADLB (Superseded)', state: 'Archived',
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
  '056cae0c-b450-4cc1-beb6-54f49188ba89': [
    { id: 'a-001', name: 'Study lead verification and approvals', bundleId: '056cae0c-b450-4cc1-beb6-54f49188ba89', status: 'Approved',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-02-28T14:30:00Z', updatedBy: 'study_lead' },
  ],
  'ed04e23a-a31b-42c7-a093-6c1ce8b195a0': [
    { id: 'a-002', name: 'Study lead verification and approvals', bundleId: 'ed04e23a-a31b-42c7-a093-6c1ce8b195a0', status: 'Approved',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-05T11:00:00Z', updatedBy: 'study_lead' },
  ],
  'e013152a-c32c-4b2e-ba22-2fb1aff3fadc': [
    { id: 'a-003', name: 'Study lead verification and approvals', bundleId: 'e013152a-c32c-4b2e-ba22-2fb1aff3fadc', status: 'Approved',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-01T16:00:00Z', updatedBy: 'study_lead' },
  ],
  '606518ef-9487-4115-861b-5714cbcb55d0': [
    { id: 'a-004', name: 'Study lead verification and approvals', bundleId: '606518ef-9487-4115-861b-5714cbcb55d0', status: 'PendingReview',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-18T10:00:00Z', updatedBy: 'production_programmer' },
  ],
  'ab8d6b10-4d0d-43c7-a0a7-5bb03acde779': [
    { id: 'a-005', name: 'Study lead verification and approvals', bundleId: 'ab8d6b10-4d0d-43c7-a0a7-5bb03acde779', status: 'PendingReview',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-19T09:00:00Z', updatedBy: 'production_programmer' },
  ],
  'd671b9ac-a496-403a-9028-d3d6326d2fe8': [
    { id: 'a-006', name: 'Study lead verification and approvals', bundleId: 'd671b9ac-a496-403a-9028-d3d6326d2fe8', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-20T09:00:00Z', updatedBy: 'production_programmer' },
  ],
  '8b5b6810-7ad1-498d-8684-2756c3dfd595': [
    { id: 'a-007', name: 'Study lead verification and approvals', bundleId: '8b5b6810-7ad1-498d-8684-2756c3dfd595', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-22T15:00:00Z', updatedBy: 'qc_programmer' },
  ],
  '7be21d96-7d50-42a8-9de8-95ddbc319b86': [
    { id: 'a-008', name: 'Study lead verification and approvals', bundleId: '7be21d96-7d50-42a8-9de8-95ddbc319b86', status: 'Approved',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-10T09:00:00Z', updatedBy: 'study_lead' },
  ],
  '37eaa72c-1ce0-4d35-9e94-2bcb894fc671': [
    { id: 'a-009', name: 'Study lead verification and approvals', bundleId: '37eaa72c-1ce0-4d35-9e94-2bcb894fc671', status: 'PendingReview',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-21T10:00:00Z', updatedBy: 'etan_domino' },
  ],
  '1e33a98f-0b9e-4dc0-af12-5d9d63736ba2': [
    { id: 'a-010', name: 'Study lead verification and approvals', bundleId: '1e33a98f-0b9e-4dc0-af12-5d9d63736ba2', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead', editable: false, showByDefault: true }],
      updatedAt: '2026-03-23T14:00:00Z', updatedBy: 'etan_domino' },
  ],
  '8813c744-6a8a-436d-aa20-68e072d3f829': [
    { id: 'a-011a', name: 'Protocol Lock Sign-Off', bundleId: '8813c744-6a8a-436d-aa20-68e072d3f829', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }],
      updatedAt: '2026-03-25T10:00:00Z' },
    { id: 'a-011b', name: 'Data Quality Sign-Off', bundleId: '8813c744-6a8a-436d-aa20-68e072d3f829', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
    { id: 'a-011c', name: 'Cohort Logic Sign-Off', bundleId: '8813c744-6a8a-436d-aa20-68e072d3f829', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
    { id: 'a-011d', name: 'Pipeline Execution Sign-Off', bundleId: '8813c744-6a8a-436d-aa20-68e072d3f829', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
    { id: 'a-011e', name: 'Statistical Analysis Sign-Off', bundleId: '8813c744-6a8a-436d-aa20-68e072d3f829', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
    { id: 'a-011f', name: 'Regulatory Affairs Sign-Off', bundleId: '8813c744-6a8a-436d-aa20-68e072d3f829', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
    { id: 'a-011g', name: 'Executive Release Authorization', bundleId: '8813c744-6a8a-436d-aa20-68e072d3f829', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }, { id: 'rwe-team', name: 'RWE_Team' }] },
  ],
  'a084c730-c66f-43a3-aaee-2cefbbc66ca1': [
    { id: 'a-012a', name: 'Intended Use Declaration Review', bundleId: 'a084c730-c66f-43a3-aaee-2cefbbc66ca1', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }] },
    { id: 'a-012b', name: 'Clinical Validation Review', bundleId: 'a084c730-c66f-43a3-aaee-2cefbbc66ca1', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.agnes.id, name: 'agnes_domino' }] },
  ],
  '15ec424a-0dca-4d91-b9fe-4bf2c7e3a673': [
    { id: 'a-013', name: 'Legal & Privacy Sign-Off', bundleId: '15ec424a-0dca-4d91-b9fe-4bf2c7e3a673', status: 'ConditionallyApproved',
      approvers: [{ id: MOCK_USERS.etan.id, name: 'etan_domino' }],
      updatedAt: '2026-03-22T16:00:00Z' },
  ],
  '324e6b2c-dd55-483d-bbd4-89d82a941a32': [
    { id: 'a-014', name: 'Study lead verification and approvals', bundleId: '324e6b2c-dd55-483d-bbd4-89d82a941a32', status: 'PendingSubmission',
      approvers: [{ id: MOCK_USERS.studyLead.id, name: 'study_lead' }],
      updatedAt: '2026-03-24T11:00:00Z' },
  ],
};

// ── Findings ────────────────────────────────────────────────────
var MOCK_FINDINGS = {
  '8b5b6810-7ad1-498d-8684-2756c3dfd595': [
    {
      id: 'f-001', name: 'AE onset date discrepancy with SDTM.AE',
      bundleId: '8b5b6810-7ad1-498d-8684-2756c3dfd595', severity: 'S1', status: 'InProgress',
      description: 'ADAE.ASTDT does not match expected derivation from AE.AESTDTC for 3 subjects',
      assignee: { id: MOCK_USERS.qcProg.id, name: 'qc_programmer' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: '2026-03-28T00:00:00Z',
      createdAt: '2026-03-20T10:00:00Z', updatedAt: '2026-03-22T15:00:00Z',
    },
    {
      id: 'f-002', name: 'Missing AEBODSYS for preferred term mapping',
      bundleId: '8b5b6810-7ad1-498d-8684-2756c3dfd595', severity: 'S2', status: 'ToDo',
      description: 'Body system organ class not populated for 12 records where AEDECOD is present',
      assignee: { id: MOCK_USERS.prodProg.id, name: 'production_programmer' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: '2026-03-30T00:00:00Z',
      createdAt: '2026-03-21T14:00:00Z', updatedAt: '2026-03-21T14:00:00Z',
    },
  ],
  '1e33a98f-0b9e-4dc0-af12-5d9d63736ba2': [
    {
      id: 'f-003', name: 'Related AE count mismatch vs source TLF spec',
      bundleId: '1e33a98f-0b9e-4dc0-af12-5d9d63736ba2', severity: 'S2', status: 'InReview',
      description: 'Output row counts for treatment-related AEs differ from SAP Table 14.3.1 specification',
      assignee: { id: MOCK_USERS.etan.id, name: 'etan_domino' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: '2026-03-26T00:00:00Z',
      createdAt: '2026-03-18T09:00:00Z', updatedAt: '2026-03-23T11:00:00Z',
    },
  ],
  '7be21d96-7d50-42a8-9de8-95ddbc319b86': [
    {
      id: 'f-004', name: 'Population flag derivation logic correction',
      bundleId: '7be21d96-7d50-42a8-9de8-95ddbc319b86', severity: 'S1', status: 'Done',
      description: 'Safety population flag was incorrectly excluding screen failures who received partial dose',
      assignee: { id: MOCK_USERS.etan.id, name: 'etan_domino' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: '2026-03-05T00:00:00Z',
      createdAt: '2026-02-20T10:00:00Z', updatedAt: '2026-03-04T16:00:00Z',
    },
  ],
  '606518ef-9487-4115-861b-5714cbcb55d0': [
    {
      id: 'f-005', name: 'Baseline flag derivation uses wrong visit window',
      bundleId: '606518ef-9487-4115-861b-5714cbcb55d0', severity: 'S0', status: 'InProgress',
      description: 'ABLFL set to Y for Visit 2 instead of last non-missing pre-dose value per SAP',
      assignee: { id: MOCK_USERS.prodProg.id, name: 'production_programmer' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: '2026-03-25T00:00:00Z',
      createdAt: '2026-03-15T11:00:00Z', updatedAt: '2026-03-23T09:00:00Z',
    },
    {
      id: 'f-006', name: 'PARAMCD truncation for long lab parameter names',
      bundleId: '606518ef-9487-4115-861b-5714cbcb55d0', severity: 'S3', status: 'ToDo',
      description: 'Several PARAMCD values exceed 8 characters, violating ADaM IG constraint',
      assignee: { id: MOCK_USERS.prodProg.id, name: 'production_programmer' },
      approver: { id: MOCK_USERS.studyLead.id, name: 'study_lead' },
      dueDate: null,
      createdAt: '2026-03-17T14:00:00Z', updatedAt: '2026-03-17T14:00:00Z',
    },
  ],
  '8813c744-6a8a-436d-aa20-68e072d3f829': [
    {
      id: 'f-007', name: 'OMOP CDM vocabulary version mismatch across sites',
      bundleId: '8813c744-6a8a-436d-aa20-68e072d3f829', severity: 'S1', status: 'ToDo',
      description: 'Site A uses OMOP v5.3 while Site B uses v5.4. Condition concept mappings may diverge',
      assignee: { id: MOCK_USERS.agnes.id, name: 'agnes_domino' },
      approver: { id: MOCK_USERS.agnes.id, name: 'agnes_domino' },
      dueDate: '2026-04-01T00:00:00Z',
      createdAt: '2026-03-24T09:00:00Z', updatedAt: '2026-03-24T09:00:00Z',
    },
  ],
};

// ── Gates ────────────────────────────────────────────────────────
var MOCK_GATES = {
  '8813c744-6a8a-436d-aa20-68e072d3f829': [
    { id: 'g-001', name: 'Submission Package Release Gate', bundleId: '8813c744-6a8a-436d-aa20-68e072d3f829', isOpen: false, reason: 'All stage approvals must be complete' },
    { id: 'g-002', name: 'IRQ Response Authorization Gate', bundleId: '8813c744-6a8a-436d-aa20-68e072d3f829', isOpen: false, reason: 'Pending regulatory query response' },
  ],
  'a084c730-c66f-43a3-aaee-2cefbbc66ca1': [
    { id: 'g-003', name: 'Clinical Safety Release Gate', bundleId: 'a084c730-c66f-43a3-aaee-2cefbbc66ca1', isOpen: false, reason: 'Clinical validation not yet started' },
  ],
};

// ── Attachments (real data from life-sciences-demo.domino-eval.com) ─────────
var MOCK_ATTACHMENTS = {
  "e95b42a1-ed32-4ffe-9bb2-8bc48430248d": [
    {
      id: "d8c75135-5240-486d-90f2-2ba4952f1db5",
      type: "DatasetSnapshotFile",
      identifier: { filename: "processed2.csv", datasetId: "6994fdc317b54d3d2b7dc9cd", snapshotId: "69b1a7cd17b54d3d2b7e3113", datasetName: "flows", snapshotVersion: 1, snapshotCreationTime: 1773250509169 },
      createdAt: "2026-03-11T17:42:52.078361Z",
      createdBy: { id: "690a9213abfd2c18541c6a98", firstName: "integration-test", lastName: "integration-test", userName: "integration-test" }
    },
  ],
  "15ec424a-0dca-4d91-b9fe-4bf2c7e3a673": [
    {
      id: "7fb45dd6-f0ee-4ff9-8799-2c349e89a57c",
      type: "Report",
      identifier: { branch: "master", commit: "f1d06b7ec3e01a62a0970466cce78a56e8bcb417", source: "DFS", filename: "Feb202026DataRequestReport.pdf" },
      createdAt: "2026-02-20T15:28:17.701204Z",
      createdBy: { id: "69160c9da4464d12be7f6e84", firstName: "Agnes", lastName: "Youn", userName: "agnes_domino" }
    },
    {
      id: "5f4d7bc0-1f83-498b-8ee2-b8278bfb5a5e",
      type: "Report",
      identifier: { branch: "main", commit: "be6c4e753e042acccb96ff0316d7762456ac7637", source: "GBP", filename: "Data_Access_Confirmation_DAR-A7F3B9C2.pdf" },
      createdAt: "2026-02-20T15:42:27.111756Z",
      createdBy: { id: "69160c9da4464d12be7f6e84", firstName: "Agnes", lastName: "Youn", userName: "agnes_domino" }
    },
  ],
  "a084c730-c66f-43a3-aaee-2cefbbc66ca1": [
    {
      id: "3b2a3aa3-641b-4461-af63-40bed9999447",
      type: "Report",
      identifier: { branch: "master", commit: "683d6b13f1109e06cc9e7f47687e99999456c412", source: "DFS", filename: "FDA_AI_QC_Policy_Domino.docx" },
      createdAt: "2026-02-17T21:48:50.630514Z",
      createdBy: { id: "69160c9da4464d12be7f6e84", firstName: "Agnes", lastName: "Youn", userName: "agnes_domino" }
    },
  ],
  "7be21d96-7d50-42a8-9de8-95ddbc319b86": [
    {
      id: "4163476b-0558-4478-be6d-06d53369fecb",
      type: "Report",
      identifier: { branch: "CSR", commit: "d0c4b36153de74c47832b01461707eaf2aa7955d", source: "GBP", filename: "prod/tfl/t_pop.sas" },
      createdAt: "2026-02-05T16:55:31.964776Z",
      createdBy: { id: "69160c9da4464d12be7f6e84", firstName: "Agnes", lastName: "Youn", userName: "agnes_domino" }
    },
    {
      id: "fb1c573e-4f77-48c6-8cfc-6b440c915bdf",
      type: "Report",
      identifier: { branch: "CSR", commit: "665ba40ad707fe787ada50f186977b3ec5340e6c", source: "GBP", filename: "qc/tfl/qc_t_pop.sas" },
      createdAt: "2026-02-05T16:55:51.406439Z",
      createdBy: { id: "69160c9da4464d12be7f6e84", firstName: "Agnes", lastName: "Youn", userName: "agnes_domino" }
    },
    {
      id: "a13e325e-b844-488a-be18-ee0d4f638b2d",
      type: "Report",
      identifier: { branch: "master", commit: "303a9d6a3fb94dc5f8610749dbf9c4c7fde4a8c2", source: "DFS", filename: "logs/t_pop.log" },
      createdAt: "2026-02-05T16:56:31.831242Z",
      createdBy: { id: "69160c9da4464d12be7f6e84", firstName: "Agnes", lastName: "Youn", userName: "agnes_domino" }
    },
    {
      id: "96154df3-c241-4fd4-b65f-de0cd7d145a7",
      type: "Report",
      identifier: { branch: "master", commit: "82b07e1f68b47b3aefde2dbc2f207f2f3c51e5b5", source: "DFS", filename: "tfl_qc/qc_t_pop.pdf" },
      createdAt: "2026-03-16T16:03:51.630575Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
  ],
  "ea6af769-99e2-43f8-b69b-aa60c5d0f083": [
    {
      id: "cb81739c-629e-4443-bc8c-efe0d5c9a21e",
      type: "Report",
      identifier: { branch: "CSR", commit: "d0c4b36153de74c47832b01461707eaf2aa7955d", source: "GBP", filename: "prod/tfl/t_pop.sas" },
      createdAt: "2026-02-03T23:31:30.706177Z",
      createdBy: { id: "69160c9da4464d12be7f6e84", firstName: "Agnes", lastName: "Youn", userName: "agnes_domino" }
    },
    {
      id: "3f13e913-35e7-4bd1-847e-3ffbe1290c73",
      type: "Report",
      identifier: { branch: "master", commit: "303a9d6a3fb94dc5f8610749dbf9c4c7fde4a8c2", source: "DFS", filename: "tfl/t_pop.pdf" },
      createdAt: "2026-02-03T23:39:09.352264Z",
      createdBy: { id: "69160c9da4464d12be7f6e84", firstName: "Agnes", lastName: "Youn", userName: "agnes_domino" }
    },
    {
      id: "1c3ded84-45e1-4e5c-83e5-178fa816c2c0",
      type: "Report",
      identifier: { branch: "master", commit: "303a9d6a3fb94dc5f8610749dbf9c4c7fde4a8c2", source: "DFS", filename: "tfl_qc/qc_t_pop.pdf" },
      createdAt: "2026-02-03T23:39:59.940428Z",
      createdBy: { id: "69160c9da4464d12be7f6e84", firstName: "Agnes", lastName: "Youn", userName: "agnes_domino" }
    },
    {
      id: "7709ec80-b4be-4c2d-8b01-9c3749f77e4b",
      type: "Report",
      identifier: { branch: "CSR", commit: "665ba40ad707fe787ada50f186977b3ec5340e6c", source: "GBP", filename: "qc/tfl/qc_t_pop.sas" },
      createdAt: "2026-02-03T23:40:25.519242Z",
      createdBy: { id: "69160c9da4464d12be7f6e84", firstName: "Agnes", lastName: "Youn", userName: "agnes_domino" }
    },
    {
      id: "a6b3f324-cf1d-462d-a7b5-393a009f7a55",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "logs/t_pop.log", volumeId: "0aa1d1a2-cef2-4410-8a17-ac8b93b8eb2d", snapshotId: "a59a8358-2c29-42aa-aaab-59be5488bca9", volumeName: "CDISC01_CSR_OUTPUT_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 1, snapshotCreationTime: "2025-12-10T14:38:02.571178Z" },
      createdAt: "2026-02-03T23:41:05.718152Z",
      createdBy: { id: "69160c9da4464d12be7f6e84", firstName: "Agnes", lastName: "Youn", userName: "agnes_domino" }
    },
  ],
  "8b5b6810-7ad1-498d-8684-2756c3dfd595": [
    {
      id: "2a707dcc-b6e8-413a-bcc5-72fedf62cb0d",
      type: "DatasetSnapshotFile",
      identifier: { filename: "adae.parquet", datasetId: "6972b2eb0550fa223f9d41e4", snapshotId: "6972b46e0550fa223f9d4220", datasetName: "data_buddy", snapshotVersion: 1, snapshotCreationTime: 1769124974664 },
      createdAt: "2026-01-22T23:38:24.159922Z",
      createdBy: { id: "6972a494aa27113e76bd1c6c", firstName: "Etan", lastName: "Lightstone", userName: "etan_domino" }
    },
  ],
  "37eaa72c-1ce0-4d35-9e94-2bcb894fc671": [
    {
      id: "8470e118-b24e-4d44-8d95-00cde6e41dff",
      type: "Report",
      identifier: { branch: "master", commit: "c2ce8dd3af20bf046e36c8e6cb33e9224d940d2a", source: "DFS", filename: "tfl/t_vscat.pdf" },
      createdAt: "2026-01-13T23:45:00.967106Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
  ],
  "ab8d6b10-4d0d-43c7-a0a7-5bb03acde779": [
    {
      id: "d0f8c030-50c2-48ce-aaf6-bbe46524f4c6",
      type: "Report",
      identifier: { branch: "CSR", commit: "07cd703eef6c63830235c60fab807ca48c7e126c", source: "GBP", filename: "prod/adam/ADVS.sas" },
      createdAt: "2026-01-13T23:07:59.860343Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "457b386e-8938-4650-a0da-3edfcae95e84",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "adam/advs.sas7bdat", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:09:10.645729Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "8a637261-e9a0-4360-89e4-f5ff3277017a",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "logs/ADVS.log", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:09:22.930244Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
  ],
  "606518ef-9487-4115-861b-5714cbcb55d0": [
    {
      id: "de49925a-d986-4fcd-a297-cbde2b72a0f6",
      type: "Report",
      identifier: { branch: "CSR", commit: "3bcfeea31077372356a3c3a9a1c79c2f62c44949", source: "GBP", filename: "prod/adam/ADLB.sas" },
      createdAt: "2026-01-13T23:07:44.739467Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "4e64ddc9-40da-4bea-9bfb-0355b27e87cc",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "logs/ADLB.log", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:08:55.316106Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "88411477-c442-4aee-8c7d-8efd62699108",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "adam/adlb.sas7bdat", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:09:06.023547Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
  ],
  "d671b9ac-a496-403a-9028-d3d6326d2fe8": [
    {
      id: "cdf203da-59e8-4101-bbde-91b3aad352f2",
      type: "Report",
      identifier: { branch: "CSR", commit: "9a21d089ca237e9b697b2fd918b925f6a0397cc6", source: "GBP", filename: "prod/adam/ADMH.sas" },
      createdAt: "2026-01-13T23:07:50.469292Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "414e495b-5c78-48b5-9da6-298d2848e789",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "adam/admh.sas7bdat", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:08:29.520422Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "abf31509-d261-4dd3-a1d3-6d365472170c",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "logs/ADMH.log", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:08:41.807281Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
  ],
  "e013152a-c32c-4b2e-ba22-2fb1aff3fadc": [
    {
      id: "b4ba89f8-e439-4829-8782-48875fc369cd",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "logs/ADCM.log", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:07:15.839624Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "b43f2df0-f89a-49d2-8aa9-73454cb782dc",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "adam/adcm.sas7bdat", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:07:24.442075Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "cad51eb5-ed96-4d4b-b78a-788f32d20ae1",
      type: "Report",
      identifier: { branch: "CSR", commit: "298016100116d2fc239d465474ba6ca4bbe0d565", source: "GBP", filename: "prod/adam/ADCM.sas" },
      createdAt: "2026-01-13T23:07:33.568929Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "bf44909f-032a-469d-8aa4-29eaf4770045",
      type: "Report",
      identifier: { branch: "CSR", commit: "ceb8e43c04d04a93fd859aabcabb41863192c764", source: "GBP", filename: "qc/adam/qc_ADCM.sas" },
      createdAt: "2026-01-13T23:35:22.659848Z",
      createdBy: { id: "6966cdf424fcea6bf65ad4f5", firstName: "QC", lastName: "Programmer", userName: "qc_programmer" }
    },
    {
      id: "f292276d-cb34-4e41-a3c6-039c3ff04126",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "qc/adam/adcm.sas7bdat", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:36:24.690352Z",
      createdBy: { id: "6966cdf424fcea6bf65ad4f5", firstName: "QC", lastName: "Programmer", userName: "qc_programmer" }
    },
    {
      id: "976a2af9-53a2-42b0-b895-6ff6b4211d0d",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "qc/logs/qc_ADCM.log", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:36:56.002292Z",
      createdBy: { id: "6966cdf424fcea6bf65ad4f5", firstName: "QC", lastName: "Programmer", userName: "qc_programmer" }
    },
  ],
  "ed04e23a-a31b-42c7-a093-6c1ce8b195a0": [
    {
      id: "e6dd54ad-76c0-4cdb-9307-3418729b43b1",
      type: "Report",
      identifier: { branch: "CSR", commit: "e380204efa8482abe802c86ed55e83965b26184b", source: "GBP", filename: "prod/adam/ADAE.sas" },
      createdAt: "2026-01-13T23:06:26.39443Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "207b67c0-9d73-4076-a69d-714256f2587c",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "adam/adae.sas7bdat", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:06:52.938628Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "0a7c066f-9d63-45b9-ae1e-9f34da9e5275",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "logs/ADAE.log", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:07:03.932231Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "1a806f65-5972-4190-8e45-2f922089f2ac",
      type: "Report",
      identifier: { branch: "CSR", commit: "53f4b1da1f72507cf4ea3d22ee4badbaf0b898cd", source: "GBP", filename: "qc/adam/qc_ADAE.sas" },
      createdAt: "2026-01-13T23:35:06.356409Z",
      createdBy: { id: "6966cdf424fcea6bf65ad4f5", firstName: "QC", lastName: "Programmer", userName: "qc_programmer" }
    },
    {
      id: "9ac6ccf9-bff7-4c35-8332-4de2a5274037",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "qc/adam/adae.sas7bdat", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:36:15.394723Z",
      createdBy: { id: "6966cdf424fcea6bf65ad4f5", firstName: "QC", lastName: "Programmer", userName: "qc_programmer" }
    },
    {
      id: "54fd2289-60ae-42be-94cf-7a7cd31b5cf1",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "qc/logs/qc_ADAE.log", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:36:49.218416Z",
      createdBy: { id: "6966cdf424fcea6bf65ad4f5", firstName: "QC", lastName: "Programmer", userName: "qc_programmer" }
    },
  ],
  "056cae0c-b450-4cc1-beb6-54f49188ba89": [
    {
      id: "8e623ef7-cc8b-4017-bbff-c28f8f9740c1",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "adam/adsl.sas7bdat", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:05:03.412838Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "9b892439-55b1-413a-9292-fb7c05154024",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "logs/ADSL.log", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:05:17.529113Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "9cb46e9c-00b9-404c-a26a-7555b7b5565f",
      type: "Report",
      identifier: { branch: "CSR", commit: "56e57430410ed9c45c90c3d76702c66b67811c30", source: "GBP", filename: "prod/adam/ADSL.sas" },
      createdAt: "2026-01-13T23:05:30.108661Z",
      createdBy: { id: "6926318da4464d12be7f6e86", firstName: "Production ", lastName: "Programmer", userName: "production_programmer" }
    },
    {
      id: "7939d5f6-792e-4e41-bec2-30dc72bc5a97",
      type: "Report",
      identifier: { branch: "CSR", commit: "a9468c3ecdd62ea29dddc3cedbf7b65a678bc14d", source: "GBP", filename: "qc/adam/qc_ADSL.sas" },
      createdAt: "2026-01-13T23:31:58.200064Z",
      createdBy: { id: "6966cdf424fcea6bf65ad4f5", firstName: "QC", lastName: "Programmer", userName: "qc_programmer" }
    },
    {
      id: "3f69476d-1dfe-40d1-9870-dec9c01c0de3",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "qc/adam/adsl.sas7bdat", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:36:07.332006Z",
      createdBy: { id: "6966cdf424fcea6bf65ad4f5", firstName: "QC", lastName: "Programmer", userName: "qc_programmer" }
    },
    {
      id: "13754212-d67a-4c0f-a85f-26d02de8236c",
      type: "NetAppVolumeSnapshotFile",
      identifier: { filename: "qc/logs/qc_ADSL.log", volumeId: "e1aa3ad3-7dfb-415e-9434-3a1600e198d8", snapshotId: "d32b45f1-5319-4bcb-ad0d-126a39927956", volumeName: "CDISC01_CSR_DATA_PROD", fileSystemId: "ea966c8b-e586-4df0-8584-d27f6dad4bff", fileSystemName: "domino-filesystem", snapshotVersion: 2, snapshotCreationTime: "2026-01-13T21:05:33.718109Z" },
      createdAt: "2026-01-13T23:36:43.670178Z",
      createdBy: { id: "6966cdf424fcea6bf65ad4f5", firstName: "QC", lastName: "Programmer", userName: "qc_programmer" }
    },
  ],
};


