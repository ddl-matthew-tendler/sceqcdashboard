/* ================================================================
   SCE QC Tracker — Domino App
   For pharma stat programming milestones and QC tracking
   ================================================================ */

const { ConfigProvider, Button, Table, Tag, Space, Spin, Drawer, Badge,
        Tooltip, Progress, Select, Input, Empty, Tabs, Statistic, Switch } = antd;
const { createElement: h, useState, useEffect, useCallback, useMemo } = React;

dayjs.extend(dayjs_plugin_relativeTime);

// ── Domino Theme ────────────────────────────────────────────────
const dominoTheme = {
  token: {
    colorPrimary: '#543FDE',
    colorPrimaryHover: '#3B23D1',
    colorPrimaryActive: '#311EAE',
    colorText: '#2E2E38',
    colorTextSecondary: '#65657B',
    colorTextTertiary: '#8F8FA3',
    colorSuccess: '#28A464',
    colorWarning: '#CCB718',
    colorError: '#C20A29',
    colorInfo: '#0070CC',
    colorBgContainer: '#FFFFFF',
    colorBgLayout: '#FAFAFA',
    colorBorder: '#E0E0E0',
    fontFamily: 'Inter, Lato, Helvetica Neue, Helvetica, Arial, sans-serif',
    fontSize: 14,
    borderRadius: 4,
    borderRadiusLG: 8,
  },
  components: {
    Button: { primaryShadow: 'none', defaultShadow: 'none' },
    Table: { headerBg: '#FAFAFA', rowHoverBg: '#F5F5F5' },
  },
};

// ── Highcharts Domino colors ────────────────────────────────────
Highcharts.setOptions({
  colors: ['#543FDE', '#0070CC', '#28A464', '#CCB718', '#FF6543', '#E835A7', '#2EDCC4', '#A9734C'],
  chart: { style: { fontFamily: 'Inter, Lato, Helvetica Neue, Arial, sans-serif' } },
});

// ── Default terminology (overridden by whitelabel config) ──────────
var DEFAULT_TERMS = { bundle: 'Bundle', policy: 'Policy' };

// ── Pharma stage definitions (typical stat programming lifecycle) ──
const PHARMA_STAGES = [
  'Protocol Setup',
  'SDTM Mapping',
  'ADaM Development',
  'TLF Programming',
  'Dry Run',
  'QC Review',
  'Lock Ready',
  'Submission',
];

// ── API helpers ─────────────────────────────────────────────────
async function apiFetch(url, options) {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || resp.statusText);
  }
  return resp.json();
}

function apiGet(path) { return apiFetch(path); }

function apiPost(path, body) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Utility ─────────────────────────────────────────────────────
function stateColor(state) {
  if (!state) return 'default';
  const s = state.toLowerCase();
  if (s === 'active') return 'processing';
  if (s === 'complete') return 'success';
  if (s === 'archived') return 'default';
  return 'default';
}

function approvalStatusColor(status) {
  if (!status) return '#E0E0E0';
  const s = status.toLowerCase().replace(/\s+/g, '');
  if (s === 'approved') return '#28A464';
  if (s === 'conditionallyapproved') return '#0070CC';
  if (s === 'pendingsubmission') return '#CCB718';
  if (s === 'pendingreview') return '#FF6543';
  return '#E0E0E0';
}

function approvalStatusLabel(status) {
  if (!status) return 'Unknown';
  return status.replace(/([A-Z])/g, ' $1').trim();
}

function severityColor(sev) {
  const map = { S0: '#C20A29', S1: '#FF6543', S2: '#CCB718', S3: '#0070CC' };
  return map[sev] || '#8F8FA3';
}

function findingStatusTag(status) {
  const colorMap = {
    ToDo: 'default', InProgress: 'processing',
    InReview: 'warning', Done: 'success', WontDo: 'default',
  };
  return h(Tag, { color: colorMap[status] || 'default' },
    (status || '').replace(/([A-Z])/g, ' $1').trim()
  );
}

// Get the bundle's own stage names (from SCE QC)
function getBundleStageNames(bundle) {
  if (!bundle.stages || bundle.stages.length === 0) return [];
  return bundle.stages.map(function(s) { return s.stage ? s.stage.name : ''; }).filter(Boolean);
}

// Derive which stage index a bundle is currently at (within its own stages)
function deriveBundleStageIndex(bundle) {
  var stageNames = getBundleStageNames(bundle);
  if (stageNames.length === 0) return 0;
  var currentStageName = bundle.stage || '';
  for (var i = 0; i < stageNames.length; i++) {
    if (stageNames[i] === currentStageName) return i;
  }
  // Fallback: try partial match
  for (var j = 0; j < stageNames.length; j++) {
    if (currentStageName.toLowerCase().indexOf(stageNames[j].toLowerCase().split(' ')[0].toLowerCase()) >= 0 ||
        stageNames[j].toLowerCase().indexOf(currentStageName.toLowerCase().split(' ')[0].toLowerCase()) >= 0) {
      return j;
    }
  }
  return 0;
}

// Get progress percentage for a bundle
function getBundleProgress(bundle) {
  var stageNames = getBundleStageNames(bundle);
  if (stageNames.length <= 1) return bundle.state === 'Complete' ? 100 : 0;
  var idx = deriveBundleStageIndex(bundle);
  if (bundle.state === 'Complete') return 100;
  return Math.round((idx / (stageNames.length - 1)) * 100);
}


// ═══════════════════════════════════════════════════════════════
//  COMPONENTS
// ═══════════════════════════════════════════════════════════════

// ── TopNav ──────────────────────────────────────────────────────
function TopNav(props) {
  var terms = props.terms || DEFAULT_TERMS;
  var useDummy = props.useDummy;
  var onToggleDummy = props.onToggleDummy;
  var connected = props.connected;
  // Only show whitelabel badge if terms differ from defaults
  var isWhitelabeled = terms.bundle !== DEFAULT_TERMS.bundle || terms.policy !== DEFAULT_TERMS.policy;
  return h('div', { className: 'top-nav' },
    h('img', { src: 'static/../domino-logo.svg', className: 'top-nav-logo', alt: 'Domino' }),
    h('div', { className: 'top-nav-divider' }),
    h('span', { className: 'top-nav-title' }, 'SCE QC Tracker'),
    h('div', { className: 'top-nav-right' },
      isWhitelabeled
        ? h(Tooltip, { title: terms.bundle + 's & ' + terms.policy + ' terminology active' },
            h('span', { className: 'top-nav-whitelabel-badge' },
              terms.bundle + 's / ' + terms.policy
            )
          )
        : null,
      !connected
        ? h('div', { className: 'dummy-data-toggle' },
            h('span', { className: 'top-nav-env' }, 'Dummy Data'),
            h(Switch, {
              checked: useDummy,
              onChange: onToggleDummy,
              size: 'small',
            })
          )
        : null,
      h('span', { className: 'top-nav-env' }, 'SCE QC Dashboard')
    )
  );
}

// ── Sidebar ─────────────────────────────────────────────────────
var NAV_ITEMS = [
  { key: 'dashboard', icon: '\u25A3', label: 'Dashboard' },
  { key: 'milestones', icon: '\u2630', label: 'Milestones' },
  { key: 'approvals', icon: '\u2713', label: 'Approvals' },
  { key: 'findings', icon: '\u26A0', label: 'Findings & QC' },
  { key: 'metrics', icon: '\u2261', label: 'Team Metrics' },
];

function Sidebar(props) {
  var active = props.active;
  var onNav = props.onNav;
  return h('div', { className: 'sidebar' },
    NAV_ITEMS.map(function(item) {
      return h('div', {
        key: item.key,
        className: 'sidebar-item' + (active === item.key ? ' active' : ''),
        onClick: function() { onNav(item.key); },
      },
        h('span', { className: 'sidebar-icon' }, item.icon),
        h('span', null, item.label)
      );
    })
  );
}

// ── Stat Card ───────────────────────────────────────────────────
function StatCard(props) {
  return h('div', { className: 'stat-card' },
    h('div', { className: 'stat-card-label' }, props.label),
    h('div', { className: 'stat-card-value ' + (props.color || '') }, props.value),
    props.sub ? h('div', { className: 'stat-card-sub' }, props.sub) : null
  );
}

// (ConnectionBanner removed — replaced by Dummy Data toggle in TopNav)

// ── Empty State ─────────────────────────────────────────────────
function EmptyState(props) {
  return h('div', { className: 'empty-state' },
    h('div', { className: 'empty-state-icon' }, props.icon || '\u2636'),
    h('div', { className: 'empty-state-text' }, props.text || 'No data'),
    props.sub ? h('div', { className: 'empty-state-sub' }, props.sub) : null
  );
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: Dashboard
// ═══════════════════════════════════════════════════════════════
function DashboardPage(props) {
  var bundles = props.bundles;
  var loading = props.loading;
  var onSelectBundle = props.onSelectBundle;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;   // e.g. "Bundle" or "Deliverable"
  var P = terms.policy;   // e.g. "Policy" or "QC Plan"

  var stats = useMemo(function() {
    var total = bundles.length;
    var active = bundles.filter(function(b) { return b.state === 'Active'; }).length;
    var complete = bundles.filter(function(b) { return b.state === 'Complete'; }).length;
    var archived = bundles.filter(function(b) { return b.state === 'Archived'; }).length;

    // Count total findings across all bundles
    var totalFindings = 0;
    var openFindings = 0;
    bundles.forEach(function(b) {
      if (b._findings) {
        totalFindings += b._findings.length;
        b._findings.forEach(function(f) {
          if (f.status !== 'Done' && f.status !== 'WontDo') openFindings++;
        });
      }
    });

    // Average stage progress
    var avgProgress = 0;
    if (total > 0) {
      var sum = 0;
      bundles.forEach(function(b) {
        sum += getBundleProgress(b);
      });
      avgProgress = Math.round(sum / total);
    }

    return { total: total, active: active, complete: complete, archived: archived,
             totalFindings: totalFindings, openFindings: openFindings, avgProgress: avgProgress };
  }, [bundles]);

  // Status chart
  useEffect(function() {
    if (bundles.length === 0) return;
    Highcharts.chart('chart-status-dist', {
      chart: { type: 'pie', height: 260, backgroundColor: 'transparent' },
      title: { text: null },
      plotOptions: {
        pie: {
          innerSize: '55%',
          dataLabels: { enabled: true, format: '{point.name}: {point.y}', style: { fontSize: '11px' } },
        },
      },
      series: [{
        name: B + 's',
        data: [
          { name: 'Active', y: stats.active, color: '#543FDE' },
          { name: 'Complete', y: stats.complete, color: '#28A464' },
          { name: 'Archived', y: stats.archived, color: '#B0B0C0' },
        ].filter(function(d) { return d.y > 0; }),
      }],
      credits: { enabled: false },
    });
  }, [bundles, stats]);

  // Stage distribution chart — group bundles by their current stage name
  useEffect(function() {
    if (bundles.length === 0) return;
    var stageMap = {};
    bundles.forEach(function(b) {
      var stageName = b.stage || 'Unknown';
      stageMap[stageName] = (stageMap[stageName] || 0) + 1;
    });
    var stageNames = Object.keys(stageMap);
    var stageCounts = stageNames.map(function(n) { return stageMap[n]; });
    Highcharts.chart('chart-stage-dist', {
      chart: { type: 'bar', height: Math.max(260, stageNames.length * 30), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: stageNames, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: null }, allowDecimals: false },
      plotOptions: { bar: { borderRadius: 3 } },
      series: [{ name: B + 's', data: stageCounts, showInLegend: false }],
      credits: { enabled: false },
    });
  }, [bundles]);

  var columns = [
    {
      title: B, dataIndex: 'name', key: 'name',
      render: function(text, record) {
        return h('a', { onClick: function() { onSelectBundle(record); }, style: { fontWeight: 500 } }, text);
      },
    },
    {
      title: 'Project', dataIndex: 'projectName', key: 'project',
      render: function(text) { return h('span', { style: { color: '#65657B', fontSize: 12 } }, text || '\u2014'); },
    },
    {
      title: P, dataIndex: 'policyName', key: 'policy',
      render: function(text) { return h(Tag, null, text || '\u2014'); },
    },
    {
      title: 'Stage', key: 'stage',
      render: function(_, record) {
        var pct = getBundleProgress(record);
        return h(Space, { direction: 'vertical', size: 2 },
          h('span', { style: { fontSize: 12, fontWeight: 500 } }, record.stage || '\u2014'),
          h(Progress, { percent: pct, size: 'small', showInfo: false, strokeColor: '#543FDE' })
        );
      },
    },
    {
      title: 'State', dataIndex: 'state', key: 'state',
      render: function(state) { return h(Tag, { color: stateColor(state) }, state); },
    },
    {
      title: 'Updated', dataIndex: 'updatedAt', key: 'updated',
      render: function(d) { return d ? dayjs(d).fromNow() : '\u2014'; },
      sorter: function(a, b) { return new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0); },
    },
  ];

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'SCE QC Dashboard'),
      h('p', null, 'Overview of all ' + B.toLowerCase() + 's tracked through SCE QC')
    ),

    // Stat cards
    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Total ' + B + 's', value: stats.total, color: 'primary' }),
      h(StatCard, { label: 'Active', value: stats.active, color: 'info', sub: 'Currently in progress' }),
      h(StatCard, { label: 'Complete', value: stats.complete, color: 'success' }),
      h(StatCard, { label: 'Open Findings', value: stats.openFindings, color: stats.openFindings > 0 ? 'warning' : '', sub: stats.totalFindings + ' total findings' }),
      h(StatCard, { label: 'Avg Progress', value: stats.avgProgress + '%', sub: 'Across active ' + B.toLowerCase() + 's' })
    ),

    // Charts row
    h('div', { className: 'two-col' },
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, B + ' Status Distribution')),
        h('div', { className: 'panel-body' },
          bundles.length > 0
            ? h('div', { id: 'chart-status-dist', className: 'chart-container' })
            : h(EmptyState, { text: 'No ' + B.toLowerCase() + 's found' })
        )
      ),
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, B + 's by Stage')),
        h('div', { className: 'panel-body' },
          bundles.length > 0
            ? h('div', { id: 'chart-stage-dist', className: 'chart-container' })
            : h(EmptyState, { text: 'No ' + B.toLowerCase() + 's found' })
        )
      )
    ),

    // Table
    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'All ' + B + 's'),
        h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, bundles.length + ' ' + B.toLowerCase() + 's')
      ),
      h('div', { className: 'panel-body-flush' },
        h(Table, {
          dataSource: bundles,
          columns: columns,
          rowKey: 'id',
          loading: loading,
          pagination: { pageSize: 10, size: 'small' },
          size: 'small',
        })
      )
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: Milestones
// ═══════════════════════════════════════════════════════════════
function MilestonesPage(props) {
  var bundles = props.bundles;
  var loading = props.loading;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;

  var activeBundles = useMemo(function() {
    return bundles.filter(function(b) { return b.state === 'Active'; });
  }, [bundles]);

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Milestone Tracker'),
      h('p', null, 'Visual stage progression for active ' + B.toLowerCase() + 's')
    ),
    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Programming Milestones'),
        h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, activeBundles.length + ' active ' + B.toLowerCase() + 's')
      ),
      loading
        ? h('div', { className: 'loading-container' }, h(Spin, null))
        : activeBundles.length === 0
          ? h(EmptyState, { text: 'No active ' + B.toLowerCase() + 's', sub: B + 's will appear here once created in SCE QC' })
          : h('div', { className: 'panel-body-flush' },
              // Each bundle row with its own stages
              activeBundles.map(function(bundle) {
                var stageNames = getBundleStageNames(bundle);
                var currentIdx = deriveBundleStageIndex(bundle);
                return h('div', { key: bundle.id, className: 'milestone-row' },
                  h('div', { className: 'milestone-bundle-name' },
                    h(Tooltip, { title: bundle.name }, bundle.name)
                  ),
                  h('div', { className: 'milestone-track' },
                    stageNames.map(function(stage, idx) {
                      var cls = 'milestone-stage ';
                      if (idx < currentIdx) cls += 'completed';
                      else if (idx === currentIdx) cls += 'current';
                      else cls += 'pending';
                      // Shorten label: first 2 words
                      var label = stage.split(' ').slice(0, 2).join(' ');
                      return h('div', { key: stage, className: cls, title: stage },
                        idx <= currentIdx ? label : ''
                      );
                    })
                  ),
                  h('div', { className: 'milestone-status' },
                    h(Tag, { color: stateColor(bundle.state) }, bundle.state)
                  )
                );
              })
            )
    ),

    // Timeline chart
    h('div', { className: 'panel', style: { marginTop: 20 } },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Stage Duration Analysis')
      ),
      h('div', { className: 'panel-body' },
        activeBundles.length > 0
          ? h(MilestoneDurationChart, { bundles: activeBundles })
          : h(EmptyState, { text: 'No data for duration analysis' })
      )
    )
  );
}

function MilestoneDurationChart(props) {
  useEffect(function() {
    var bundles = props.bundles;
    // Collect all unique stage names across all bundles, create synthetic durations
    var allStageNames = [];
    var seriesData = bundles.slice(0, 10).map(function(b) {
      var stageNames = getBundleStageNames(b);
      var currentIdx = deriveBundleStageIndex(b);
      var stages = [];
      for (var i = 0; i <= currentIdx; i++) {
        var name = stageNames[i];
        stages.push({ stage: name, days: Math.floor(Math.random() * 14) + 3 });
        if (allStageNames.indexOf(name) === -1) allStageNames.push(name);
      }
      return { name: b.name, stages: stages };
    });

    Highcharts.chart('chart-duration', {
      chart: { type: 'bar', height: Math.max(280, seriesData.length * 40), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: seriesData.map(function(s) { return s.name; }), labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: 'Days' }, stackLabels: { enabled: true, style: { fontSize: '10px' } } },
      plotOptions: { series: { stacking: 'normal', borderRadius: 2 } },
      series: allStageNames.map(function(stage) {
        return {
          name: stage.split(' ').slice(0, 3).join(' '),
          data: seriesData.map(function(s) {
            var match = s.stages.find(function(st) { return st.stage === stage; });
            return match ? match.days : 0;
          }),
        };
      }),
      credits: { enabled: false },
    });
  }, [props.bundles]);

  return h('div', { id: 'chart-duration', className: 'chart-container', style: { minHeight: 300 } });
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: Approvals
// ═══════════════════════════════════════════════════════════════
function ApprovalsPage(props) {
  var bundles = props.bundles;
  var loading = props.loading;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;
  var P = terms.policy;

  // Flatten all approvals from all bundles
  var allApprovals = useMemo(function() {
    var result = [];
    bundles.forEach(function(b) {
      if (b._approvals) {
        b._approvals.forEach(function(a) {
          result.push(Object.assign({}, a, { _bundleName: b.name, _bundleId: b.id }));
        });
      }
    });
    return result;
  }, [bundles]);

  var approvalStats = useMemo(function() {
    var pending = 0, approved = 0, conditional = 0, review = 0;
    allApprovals.forEach(function(a) {
      var s = (a.status || '').toLowerCase().replace(/\s+/g, '');
      if (s === 'approved') approved++;
      else if (s === 'conditionallyapproved') conditional++;
      else if (s === 'pendingreview') review++;
      else pending++;
    });
    return { pending: pending, approved: approved, conditional: conditional, review: review, total: allApprovals.length };
  }, [allApprovals]);

  // Approval funnel chart
  useEffect(function() {
    if (allApprovals.length === 0) return;
    Highcharts.chart('chart-approval-funnel', {
      chart: { type: 'column', height: 260, backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: ['Pending Submission', 'Pending Review', 'Conditionally Approved', 'Approved'], labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: 'Count' }, allowDecimals: false },
      series: [{
        name: 'Approvals',
        data: [
          { y: approvalStats.pending, color: '#CCB718' },
          { y: approvalStats.review, color: '#FF6543' },
          { y: approvalStats.conditional, color: '#0070CC' },
          { y: approvalStats.approved, color: '#28A464' },
        ],
        showInLegend: false,
      }],
      plotOptions: { column: { borderRadius: 4 } },
      credits: { enabled: false },
    });
  }, [allApprovals, approvalStats]);

  var columns = [
    { title: B, dataIndex: '_bundleName', key: 'study', width: 200,
      render: function(text) { return h('span', { style: { fontWeight: 500 } }, text); } },
    { title: 'Approval', dataIndex: 'name', key: 'name' },
    { title: 'Status', dataIndex: 'status', key: 'status',
      render: function(status) {
        return h(Tag, { color: approvalStatusColor(status), style: { color: '#fff', border: 'none' } },
          approvalStatusLabel(status));
      },
      filters: [
        { text: 'Pending Submission', value: 'PendingSubmission' },
        { text: 'Pending Review', value: 'PendingReview' },
        { text: 'Conditionally Approved', value: 'ConditionallyApproved' },
        { text: 'Approved', value: 'Approved' },
      ],
      onFilter: function(value, record) { return record.status === value; },
    },
    { title: 'Approvers', key: 'approvers',
      render: function(_, record) {
        if (!record.approvers || record.approvers.length === 0) return '\u2014';
        return record.approvers.map(function(a) { return a.name; }).join(', ');
      },
    },
    { title: 'Updated', dataIndex: 'updatedAt', key: 'updated',
      render: function(d) { return d ? dayjs(d).fromNow() : '\u2014'; },
    },
  ];

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Approval Tracker'),
      h('p', null, 'Review and approval status across all ' + B.toLowerCase() + 's')
    ),

    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Total Approvals', value: approvalStats.total, color: 'primary' }),
      h(StatCard, { label: 'Pending', value: approvalStats.pending + approvalStats.review, color: 'warning', sub: 'Awaiting action' }),
      h(StatCard, { label: 'Approved', value: approvalStats.approved, color: 'success' }),
      h(StatCard, { label: 'Conditional', value: approvalStats.conditional, color: 'info' })
    ),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, 'Approval Pipeline')),
      h('div', { className: 'panel-body' },
        allApprovals.length > 0
          ? h('div', { id: 'chart-approval-funnel', className: 'chart-container' })
          : h(EmptyState, { text: 'No approval data' })
      )
    ),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'All Approvals'),
        h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, allApprovals.length + ' total')
      ),
      h('div', { className: 'panel-body-flush' },
        h(Table, {
          dataSource: allApprovals,
          columns: columns,
          rowKey: function(r) { return r.id || (r._bundleId + '-' + r.name); },
          loading: loading,
          pagination: { pageSize: 10, size: 'small' },
          size: 'small',
        })
      )
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: Findings & QC
// ═══════════════════════════════════════════════════════════════
function FindingsPage(props) {
  var bundles = props.bundles;
  var loading = props.loading;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;

  var allFindings = useMemo(function() {
    var result = [];
    bundles.forEach(function(b) {
      if (b._findings) {
        b._findings.forEach(function(f) {
          result.push(Object.assign({}, f, { _bundleName: b.name }));
        });
      }
    });
    return result;
  }, [bundles]);

  var findingStats = useMemo(function() {
    var bySev = { S0: 0, S1: 0, S2: 0, S3: 0 };
    var byStatus = { ToDo: 0, InProgress: 0, InReview: 0, Done: 0, WontDo: 0 };
    var open = 0;
    allFindings.forEach(function(f) {
      if (bySev[f.severity] !== undefined) bySev[f.severity]++;
      if (byStatus[f.status] !== undefined) byStatus[f.status]++;
      if (f.status !== 'Done' && f.status !== 'WontDo') open++;
    });
    return { bySev: bySev, byStatus: byStatus, open: open, total: allFindings.length };
  }, [allFindings]);

  // Severity chart
  useEffect(function() {
    if (allFindings.length === 0) return;
    Highcharts.chart('chart-findings-sev', {
      chart: { type: 'pie', height: 240, backgroundColor: 'transparent' },
      title: { text: null },
      series: [{
        name: 'Findings',
        innerSize: '50%',
        data: [
          { name: 'S0 - Critical', y: findingStats.bySev.S0, color: '#C20A29' },
          { name: 'S1 - High', y: findingStats.bySev.S1, color: '#FF6543' },
          { name: 'S2 - Medium', y: findingStats.bySev.S2, color: '#CCB718' },
          { name: 'S3 - Low', y: findingStats.bySev.S3, color: '#0070CC' },
        ].filter(function(d) { return d.y > 0; }),
      }],
      plotOptions: { pie: { dataLabels: { format: '{point.name}: {point.y}', style: { fontSize: '11px' } } } },
      credits: { enabled: false },
    });
  }, [allFindings, findingStats]);

  // Status chart
  useEffect(function() {
    if (allFindings.length === 0) return;
    Highcharts.chart('chart-findings-status', {
      chart: { type: 'column', height: 240, backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: ['To Do', 'In Progress', 'In Review', 'Done', "Won't Do"], labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: null }, allowDecimals: false },
      series: [{
        name: 'Findings',
        data: [
          { y: findingStats.byStatus.ToDo, color: '#B0B0C0' },
          { y: findingStats.byStatus.InProgress, color: '#543FDE' },
          { y: findingStats.byStatus.InReview, color: '#CCB718' },
          { y: findingStats.byStatus.Done, color: '#28A464' },
          { y: findingStats.byStatus.WontDo, color: '#8F8FA3' },
        ],
        showInLegend: false,
      }],
      plotOptions: { column: { borderRadius: 4 } },
      credits: { enabled: false },
    });
  }, [allFindings, findingStats]);

  var columns = [
    { title: B, dataIndex: '_bundleName', key: 'study', width: 160,
      render: function(t) { return h('span', { style: { fontWeight: 500 } }, t); } },
    { title: 'Finding', dataIndex: 'name', key: 'name' },
    { title: 'Severity', dataIndex: 'severity', key: 'severity',
      render: function(sev) { return h(Tag, { color: severityColor(sev), style: { color: '#fff', border: 'none' } }, sev); },
      filters: ['S0', 'S1', 'S2', 'S3'].map(function(s) { return { text: s, value: s }; }),
      onFilter: function(v, r) { return r.severity === v; },
    },
    { title: 'Status', dataIndex: 'status', key: 'status', render: findingStatusTag,
      filters: ['ToDo', 'InProgress', 'InReview', 'Done', 'WontDo'].map(function(s) { return { text: s, value: s }; }),
      onFilter: function(v, r) { return r.status === v; },
    },
    { title: 'Assignee', key: 'assignee',
      render: function(_, r) { return r.assignee ? r.assignee.name : '\u2014'; } },
    { title: 'Due', dataIndex: 'dueDate', key: 'due',
      render: function(d) {
        if (!d) return '\u2014';
        var due = dayjs(d);
        var overdue = due.isBefore(dayjs());
        return h('span', { style: { color: overdue ? '#C20A29' : '#2E2E38', fontWeight: overdue ? 600 : 400 } },
          due.format('MMM D, YYYY'), overdue ? ' (overdue)' : '');
      },
    },
  ];

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Findings & QC'),
      h('p', null, 'Quality issues and review findings across all ' + B.toLowerCase() + 's')
    ),

    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Total Findings', value: findingStats.total, color: 'primary' }),
      h(StatCard, { label: 'Open', value: findingStats.open, color: findingStats.open > 0 ? 'warning' : 'success' }),
      h(StatCard, { label: 'Critical (S0)', value: findingStats.bySev.S0, color: findingStats.bySev.S0 > 0 ? 'danger' : '' }),
      h(StatCard, { label: 'Resolved', value: findingStats.byStatus.Done, color: 'success' })
    ),

    h('div', { className: 'two-col' },
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, 'By Severity')),
        h('div', { className: 'panel-body' },
          allFindings.length > 0
            ? h('div', { id: 'chart-findings-sev', className: 'chart-container' })
            : h(EmptyState, { text: 'No findings' })
        )
      ),
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, 'By Status')),
        h('div', { className: 'panel-body' },
          allFindings.length > 0
            ? h('div', { id: 'chart-findings-status', className: 'chart-container' })
            : h(EmptyState, { text: 'No findings' })
        )
      )
    ),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'All Findings'),
        h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, allFindings.length + ' total')
      ),
      h('div', { className: 'panel-body-flush' },
        h(Table, {
          dataSource: allFindings,
          columns: columns,
          rowKey: function(r) { return r.id || (r._bundleName + '-' + r.name); },
          loading: loading,
          pagination: { pageSize: 10, size: 'small' },
          size: 'small',
        })
      )
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: Team Metrics
// ═══════════════════════════════════════════════════════════════
function MetricsPage(props) {
  var bundles = props.bundles;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;
  var P = terms.policy;

  var metrics = useMemo(function() {
    var activeBundles = bundles.filter(function(b) { return b.state === 'Active'; });
    var completeBundles = bundles.filter(function(b) { return b.state === 'Complete'; });

    // Bundles per policy (team/therapeutic area proxy)
    var policyGroups = {};
    bundles.forEach(function(b) {
      var key = b.policyName || 'Unassigned';
      if (!policyGroups[key]) policyGroups[key] = { active: 0, complete: 0, total: 0 };
      policyGroups[key].total++;
      if (b.state === 'Active') policyGroups[key].active++;
      if (b.state === 'Complete') policyGroups[key].complete++;
    });

    // Assignee workload
    var assignees = {};
    bundles.forEach(function(b) {
      var name = (b.stageAssignee && b.stageAssignee.name) ? b.stageAssignee.name : 'Unassigned';
      if (!assignees[name]) assignees[name] = 0;
      assignees[name]++;
    });

    // Findings per assignee
    var findingsByAssignee = {};
    bundles.forEach(function(b) {
      if (b._findings) {
        b._findings.forEach(function(f) {
          var name = (f.assignee && f.assignee.name) ? f.assignee.name : 'Unassigned';
          if (!findingsByAssignee[name]) findingsByAssignee[name] = { open: 0, resolved: 0 };
          if (f.status === 'Done' || f.status === 'WontDo') findingsByAssignee[name].resolved++;
          else findingsByAssignee[name].open++;
        });
      }
    });

    return {
      active: activeBundles.length,
      complete: completeBundles.length,
      policyGroups: policyGroups,
      assignees: assignees,
      findingsByAssignee: findingsByAssignee,
      completionRate: bundles.length > 0 ? Math.round((completeBundles.length / bundles.length) * 100) : 0,
    };
  }, [bundles]);

  // Policy breakdown chart
  useEffect(function() {
    var groups = metrics.policyGroups;
    var names = Object.keys(groups);
    if (names.length === 0) return;
    Highcharts.chart('chart-policy-breakdown', {
      chart: { type: 'bar', height: Math.max(240, names.length * 40), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: names, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: B + 's' }, allowDecimals: false, stackLabels: { enabled: true } },
      plotOptions: { series: { stacking: 'normal', borderRadius: 2 } },
      series: [
        { name: 'Active', data: names.map(function(n) { return groups[n].active; }), color: '#543FDE' },
        { name: 'Complete', data: names.map(function(n) { return groups[n].complete; }), color: '#28A464' },
      ],
      credits: { enabled: false },
    });
  }, [metrics]);

  // Workload chart
  useEffect(function() {
    var assignees = metrics.assignees;
    var names = Object.keys(assignees).filter(function(n) { return n !== 'Unassigned'; });
    if (names.length === 0) return;
    names.sort(function(a, b) { return assignees[b] - assignees[a]; });
    Highcharts.chart('chart-workload', {
      chart: { type: 'bar', height: Math.max(240, names.length * 35), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: names, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: 'Assigned ' + B + 's' }, allowDecimals: false },
      series: [{ name: B + 's', data: names.map(function(n) { return assignees[n]; }), showInLegend: false }],
      plotOptions: { bar: { borderRadius: 3 } },
      credits: { enabled: false },
    });
  }, [metrics]);

  // Findings resolution chart
  useEffect(function() {
    var fba = metrics.findingsByAssignee;
    var names = Object.keys(fba).filter(function(n) { return n !== 'Unassigned'; });
    if (names.length === 0) return;
    Highcharts.chart('chart-findings-resolution', {
      chart: { type: 'bar', height: Math.max(240, names.length * 35), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: names, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: 'Findings' }, allowDecimals: false, stackLabels: { enabled: true } },
      plotOptions: { series: { stacking: 'normal', borderRadius: 2 } },
      series: [
        { name: 'Open', data: names.map(function(n) { return fba[n].open; }), color: '#FF6543' },
        { name: 'Resolved', data: names.map(function(n) { return fba[n].resolved; }), color: '#28A464' },
      ],
      credits: { enabled: false },
    });
  }, [metrics]);

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Team Metrics'),
      h('p', null, 'Workload distribution, productivity, and quality metrics')
    ),

    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Active ' + B + 's', value: metrics.active, color: 'primary' }),
      h(StatCard, { label: 'Completed', value: metrics.complete, color: 'success' }),
      h(StatCard, { label: 'Completion Rate', value: metrics.completionRate + '%', color: metrics.completionRate >= 50 ? 'success' : 'warning' }),
      h(StatCard, { label: P + 's In Use', value: Object.keys(metrics.policyGroups).length })
    ),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, B + 's by ' + P + ' / Therapeutic Area')),
      h('div', { className: 'panel-body' },
        Object.keys(metrics.policyGroups).length > 0
          ? h('div', { id: 'chart-policy-breakdown', className: 'chart-container' })
          : h(EmptyState, { text: 'No policy data' })
      )
    ),

    h('div', { className: 'two-col' },
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, 'Assignee Workload')),
        h('div', { className: 'panel-body' },
          Object.keys(metrics.assignees).length > 1 || (Object.keys(metrics.assignees).length === 1 && !metrics.assignees['Unassigned'])
            ? h('div', { id: 'chart-workload', className: 'chart-container' })
            : h(EmptyState, { text: 'No assignee data', sub: 'Assign stage owners in SCE QC' })
        )
      ),
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, 'Findings Resolution by Assignee')),
        h('div', { className: 'panel-body' },
          Object.keys(metrics.findingsByAssignee).length > 1 || (Object.keys(metrics.findingsByAssignee).length === 1 && !metrics.findingsByAssignee['Unassigned'])
            ? h('div', { id: 'chart-findings-resolution', className: 'chart-container' })
            : h(EmptyState, { text: 'No findings data' })
        )
      )
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  Study Detail Drawer
// ═══════════════════════════════════════════════════════════════
function DetailDrawer(props) {
  var bundle = props.bundle;
  var visible = props.visible;
  var onClose = props.onClose;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;
  var P = terms.policy;

  if (!bundle) return null;

  var stageIdx = deriveBundleStageIndex(bundle);

  return h(Drawer, {
    title: bundle.name,
    open: visible,
    onClose: onClose,
    width: 480,
  },
    // Overview
    h('div', { className: 'detail-section' },
      h('div', { className: 'detail-section-title' }, B + ' Overview'),
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, 'State'),
        h('span', { className: 'detail-field-value' }, h(Tag, { color: stateColor(bundle.state) }, bundle.state))
      ),
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, 'Project'),
        h('span', { className: 'detail-field-value' }, bundle.projectName || '\u2014')
      ),
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, P),
        h('span', { className: 'detail-field-value' }, bundle.policyName || '\u2014')
      ),
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, 'Current Stage'),
        h('span', { className: 'detail-field-value' }, bundle.stage || '\u2014')
      ),
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, 'Progress'),
        h('span', { className: 'detail-field-value' },
          h(Progress, { percent: getBundleProgress(bundle), size: 'small', strokeColor: '#543FDE' })
        )
      ),
      bundle.stageAssignee && bundle.stageAssignee.name
        ? h('div', { className: 'detail-field' },
            h('span', { className: 'detail-field-label' }, 'Stage Owner'),
            h('span', { className: 'detail-field-value' }, bundle.stageAssignee.name)
          )
        : null,
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, 'Created'),
        h('span', { className: 'detail-field-value' }, bundle.createdAt ? dayjs(bundle.createdAt).format('MMM D, YYYY') : '\u2014')
      )
    ),

    // Approvals
    bundle._approvals && bundle._approvals.length > 0
      ? h('div', { className: 'detail-section' },
          h('div', { className: 'detail-section-title' }, 'Approvals (' + bundle._approvals.length + ')'),
          bundle._approvals.map(function(a, i) {
            return h('div', { key: i, className: 'approval-item', style: { padding: '8px 0' } },
              h('div', { className: 'approval-dot ' + (a.status || '').toLowerCase().replace(/\s+/g, '').replace('pending', 'pending').replace('approved', 'approved').replace('conditionallyapproved', 'conditional') }),
              h('div', { className: 'approval-info' },
                h('div', { className: 'approval-name' }, a.name),
                h('div', { className: 'approval-meta' }, approvalStatusLabel(a.status))
              )
            );
          })
        )
      : null,

    // Findings summary
    bundle._findings && bundle._findings.length > 0
      ? h('div', { className: 'detail-section' },
          h('div', { className: 'detail-section-title' }, 'Findings (' + bundle._findings.length + ')'),
          bundle._findings.slice(0, 5).map(function(f, i) {
            return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F5F5F8' } },
              h(Tag, { color: severityColor(f.severity), style: { color: '#fff', border: 'none', minWidth: 28, textAlign: 'center' } }, f.severity),
              h('span', { style: { flex: 1, fontSize: 13 } }, f.name),
              findingStatusTag(f.status)
            );
          }),
          bundle._findings.length > 5
            ? h('div', { style: { fontSize: 12, color: '#8F8FA3', padding: '8px 0' } },
                '+ ' + (bundle._findings.length - 5) + ' more findings')
            : null
        )
      : null,

    // Gates
    bundle._gates && bundle._gates.length > 0
      ? h('div', { className: 'detail-section' },
          h('div', { className: 'detail-section-title' }, 'Gates (' + bundle._gates.length + ')'),
          bundle._gates.map(function(g, i) {
            return h('div', { key: i, className: 'detail-field' },
              h('span', { className: 'detail-field-label' }, g.name),
              h('span', { className: 'detail-field-value' },
                h(Tag, { color: g.isOpen ? 'success' : 'error' }, g.isOpen ? 'Open' : 'Closed')
              )
            );
          })
        )
      : null
  );
}


// ═══════════════════════════════════════════════════════════════
//  ROOT APP
// ═══════════════════════════════════════════════════════════════
function App() {
  var _s1 = useState('dashboard'); var activePage = _s1[0]; var setActivePage = _s1[1];
  var _s2 = useState([]); var bundles = _s2[0]; var setBundles = _s2[1];
  var _s3 = useState(true); var loading = _s3[0]; var setLoading = _s3[1];
  var _s4 = useState(false); var connected = _s4[0]; var setConnected = _s4[1];
  var _s5 = useState(null); var selectedBundle = _s5[0]; var setSelectedBundle = _s5[1];
  var _s6 = useState(false); var drawerOpen = _s6[0]; var setDrawerOpen = _s6[1];
  var _s7 = useState(null); var error = _s7[0]; var setError = _s7[1];
  var _s8 = useState(DEFAULT_TERMS); var terms = _s8[0]; var setTerms = _s8[1];
  var _s9 = useState(true); var useDummy = _s9[0]; var setUseDummy = _s9[1];

  // Load mock/dummy data
  function loadMockData() {
    setConnected(false);
    if (typeof MOCK_BUNDLES !== 'undefined') {
      var mockEnriched = MOCK_BUNDLES.map(function(b) {
        var copy = Object.assign({}, b);
        copy._approvals = (typeof MOCK_APPROVALS !== 'undefined' && MOCK_APPROVALS[b.id]) || [];
        copy._findings = (typeof MOCK_FINDINGS !== 'undefined' && MOCK_FINDINGS[b.id]) || [];
        copy._gates = (typeof MOCK_GATES !== 'undefined' && MOCK_GATES[b.id]) || [];
        return copy;
      });
      setBundles(mockEnriched);
    } else {
      setBundles([]);
    }
    if (typeof MOCK_TERMINOLOGY !== 'undefined') {
      setTerms(MOCK_TERMINOLOGY);
    }
    setLoading(false);
    setError(null);
  }

  // Fetch live data from Domino
  function fetchLiveData() {
    setLoading(true);
    setError(null);
    apiGet('api/bundles?limit=100')
      .then(function(resp) {
        var bundleList = resp.data || [];
        setConnected(true);
        var enrichPromises = bundleList.map(function(bundle) {
          return Promise.all([
            apiGet('api/bundles/' + bundle.id + '/approvals').catch(function() { return []; }),
            apiGet('api/bundles/' + bundle.id + '/findings?limit=100').catch(function() { return { data: [] }; }),
            apiGet('api/bundles/' + bundle.id + '/gates').catch(function() { return []; }),
          ]).then(function(results) {
            bundle._approvals = Array.isArray(results[0]) ? results[0] : [];
            bundle._findings = results[1].data || (Array.isArray(results[1]) ? results[1] : []);
            bundle._gates = Array.isArray(results[2]) ? results[2] : [];
            return bundle;
          });
        });
        return Promise.all(enrichPromises);
      })
      .then(function(enrichedBundles) {
        setBundles(enrichedBundles);
        setLoading(false);
      })
      .catch(function(err) {
        console.error('Failed to fetch live data, falling back to dummy data:', err);
        setUseDummy(true);
        loadMockData();
      });
  }

  // On mount: try live data first, fall back to dummy
  useEffect(function() {
    fetchLiveData();
  }, []);

  // Handle dummy data toggle
  function handleToggleDummy(checked) {
    setUseDummy(checked);
    if (checked) {
      loadMockData();
    } else {
      fetchLiveData();
    }
  }

  // Fetch whitelabel terminology when connected to live Domino
  useEffect(function() {
    if (!connected) return;
    apiGet('api/terminology')
      .then(function(t) { setTerms(t); })
      .catch(function() {});
  }, [connected]);

  function handleSelectBundle(bundle) {
    setSelectedBundle(bundle);
    setDrawerOpen(true);
  }

  function renderPage() {
    switch (activePage) {
      case 'dashboard':
        return h(DashboardPage, { bundles: bundles, loading: loading, onSelectBundle: handleSelectBundle, terms: terms });
      case 'milestones':
        return h(MilestonesPage, { bundles: bundles, loading: loading, terms: terms });
      case 'approvals':
        return h(ApprovalsPage, { bundles: bundles, loading: loading, terms: terms });
      case 'findings':
        return h(FindingsPage, { bundles: bundles, loading: loading, terms: terms });
      case 'metrics':
        return h(MetricsPage, { bundles: bundles, terms: terms });
      default:
        return h(DashboardPage, { bundles: bundles, loading: loading, onSelectBundle: handleSelectBundle, terms: terms });
    }
  }

  return h(ConfigProvider, { theme: dominoTheme },
    h('div', null,
      h(TopNav, { terms: terms, useDummy: useDummy, onToggleDummy: handleToggleDummy, connected: connected }),
      h('div', { className: 'app-layout' },
        h(Sidebar, { active: activePage, onNav: setActivePage }),
        h('div', { className: 'main-content' },
          renderPage()
        )
      ),
      h(DetailDrawer, {
        bundle: selectedBundle,
        visible: drawerOpen,
        onClose: function() { setDrawerOpen(false); },
        terms: terms,
      })
    )
  );
}

// ── Mount ───────────────────────────────────────────────────────
var root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(App));
