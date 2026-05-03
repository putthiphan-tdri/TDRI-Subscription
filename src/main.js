const STORAGE_KEY = 'tdri-subscription-ledger-v1';

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
});

const compactMoneyFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const seedData = {
  team: [{ id: 'admin', name: 'Team Member', role: '', color: '#5f7cff' }],
  projects: [],
  subscriptions: [],
};

let state = loadState();
let ui = {
  filter: 'All',
  query: '',
  sortKey: 'product',
  sortDirection: 'asc',
  modal: null,
  toast: '',
  loading: true,
  formError: '',
  visiblePasswords: new Set(),
};
let searchRenderTimer = 0;

setTimeout(() => {
  ui.loading = false;
  render();
}, 260);

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return normalizeState(JSON.parse(stored));
    }
  } catch (error) {
    console.warn('Could not read saved subscription ledger.', error);
  }

  return normalizeState(structuredClone(seedData));
}

function normalizeState(data) {
  const team = Array.isArray(data.team) && data.team.length ? data.team : structuredClone(seedData.team);
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const subscriptions = Array.isArray(data.subscriptions) ? data.subscriptions : [];

  return {
    ...data,
    team,
    projects,
    subscriptions: subscriptions.map((subscription) => {
      const { vendor, ...subscriptionWithoutVendor } = subscription;

      return {
        ...subscriptionWithoutVendor,
        password: typeof subscription.password === 'string' ? subscription.password : '',
        credentialNote: shouldShowBlankCredentialNote(subscription) ? '' : subscription.credentialNote,
        reimbursement: subscription.reimbursement || '',
        projectId: subscription.projectId || '',
        payments: (subscription.payments || []).map((payment) => ({
          ...payment,
          reimbursement: payment.reimbursement || subscription.reimbursement || 'Fund',
          projectId: payment.projectId || subscription.projectId || '',
        })),
        expanded: false,
      };
    }),
  };
}

function shouldShowBlankCredentialNote(subscription) {
  return ['chatgpt-team', 'airtable', 'perplexity'].includes(subscription.id);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function exportLedgerData() {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `tdri-subscription-ledger-${date}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Ledger JSON exported');
}

async function importLedgerData(file) {
  if (!file) {
    return;
  }

  try {
    const imported = JSON.parse(await file.text());
    state = normalizeState(imported);
    saveState();
    showToast('Ledger JSON imported');
    render();
  } catch (error) {
    console.warn('Could not import ledger JSON.', error);
    showToast('Import failed. Choose a valid ledger JSON file.');
  }
}

function getMember(id) {
  return state.team.find((member) => member.id === id) || state.team[0];
}

function getProject(id) {
  return state.projects.find((project) => project.id === id) || null;
}

function formatMoney(value, compact = false) {
  if (compact) {
    return `฿${compactMoneyFormatter.format(value)}`;
  }

  return moneyFormatter.format(value).replace('THB', '฿');
}

function chipTone(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function formatDate(value) {
  return dateFormatter.format(new Date(`${value}T00:00:00`));
}

function maskPassword(value) {
  return value ? '********' : 'No password stored';
}

function displayedPassword(subscription) {
  return ui.visiblePasswords.has(subscription.id) ? subscription.password : maskPassword(subscription.password);
}

function getSubscriptionTotal(subscription) {
  return subscription.payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
}

function getLatestPayment(subscription) {
  return [...subscription.payments].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
}

function getPaymentMonthlyAmount(payment) {
  const amount = Number(payment?.amount || 0);

  if (!payment || Number.isNaN(amount)) {
    return 0;
  }

  if (payment.type === 'Monthly') {
    return amount;
  }

  if (payment.type === 'Annually') {
    return amount / 12;
  }

  if (payment.type === 'Quarterly') {
    return amount / 3;
  }

  if (payment.type === 'One Time') {
    return 0;
  }

  return 0;
}

function isSubscriptionActive(subscription) {
  return !subscription.status || subscription.status === 'Active';
}

function getSubscriptionMonthlyCost(subscription) {
  if (!isSubscriptionActive(subscription) || subscription.paymentType === 'Free') {
    return 0;
  }

  const latest = getLatestPayment(subscription);
  return latest ? getPaymentMonthlyAmount(latest) : Number(subscription.monthlyEquivalent || 0);
}

function getStatusTotals() {
  return state.subscriptions
    .flatMap((subscription) => subscription.payments)
    .reduce(
      (totals, payment) => {
        totals[payment.status] += Number(payment.amount || 0);
        return totals;
      },
      { Pending: 0, Done: 0 },
    );
}

function getDashboardTotals() {
  const recurringActiveSubscriptions = state.subscriptions.filter(
    (subscription) => isSubscriptionActive(subscription) && subscription.paymentType !== 'One Time',
  );

  return {
    subscriptions: recurringActiveSubscriptions.length,
    monthly: state.subscriptions.reduce((total, subscription) => total + getSubscriptionMonthlyCost(subscription), 0),
    cumulative: state.subscriptions.reduce((total, subscription) => total + getSubscriptionTotal(subscription), 0),
  };
}

function getFilteredSubscriptions() {
  const query = ui.query.trim().toLowerCase();

  const subscriptions = state.subscriptions.filter((subscription) => {
    const latest = getLatestPayment(subscription);
    const latestProject = latest?.projectId ? getProject(latest.projectId) : null;
    const matchesFilter = ui.filter === 'All' || latest?.status === ui.filter;
    const searchHaystack = [
      subscription.product,
      subscription.credential,
      latest?.reimbursement,
      latestProject?.code,
      latestProject?.name,
    ]
      .join(' ')
      .toLowerCase();

    return matchesFilter && (!query || searchHaystack.includes(query));
  });

  return sortSubscriptions(subscriptions);
}

function sortSubscriptions(subscriptions) {
  if (!ui.sortKey) {
    return subscriptions;
  }

  const direction = ui.sortDirection === 'desc' ? -1 : 1;
  const valueFor = {
    product: (subscription) => subscription.product.toLowerCase(),
    totalCost: (subscription) => getSubscriptionTotal(subscription),
    lastPayment: (subscription) => new Date(getLatestPayment(subscription)?.date || 0).getTime(),
  }[ui.sortKey];

  if (!valueFor) {
    return subscriptions;
  }

  return [...subscriptions].sort((first, second) => {
    const firstValue = valueFor(first);
    const secondValue = valueFor(second);

    if (firstValue < secondValue) {
      return -1 * direction;
    }

    if (firstValue > secondValue) {
      return 1 * direction;
    }

    return first.product.localeCompare(second.product);
  });
}

function summarizeByTeam() {
  return state.team.map((member) => ({
    ...member,
    total: state.subscriptions
      .flatMap((subscription) => subscription.payments)
      .filter((payment) => payment.paidBy === member.id)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
  }));
}

function summarizeByReimbursement() {
  return state.subscriptions
    .flatMap((subscription) => subscription.payments)
    .reduce(
      (summary, subscription) => {
        if (!subscription.reimbursement) {
          return summary;
        }

        const amount = Number(subscription.amount || 0);
        summary[subscription.reimbursement] = (summary[subscription.reimbursement] || 0) + amount;
        return summary;
      },
      { Fund: 0, Project: 0, None: 0 },
    );
}

function summarizeByProject() {
  return state.projects.map((project) => ({
    ...project,
    total: state.subscriptions
      .flatMap((subscription) => subscription.payments)
      .filter((payment) => payment.reimbursement === 'Project' && payment.projectId === project.id)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    payments: state.subscriptions
      .flatMap((subscription) => subscription.payments)
      .filter((payment) => payment.reimbursement === 'Project' && payment.projectId === project.id).length,
  }));
}

function render() {
  const app = document.querySelector('#app');
  const totals = getDashboardTotals();
  const filteredSubscriptions = getFilteredSubscriptions();

  app.innerHTML = `
    <div class="app-shell">
      <div class="main-shell">
        <header class="app-header">
          <div class="page-brand" aria-label="TDRI">
            <a class="tdri-lockup" href="#app" aria-label="TDRI">
              <span>TDRI</span>
              <small>Thailand<br />Development<br />Research<br />Institute</small>
            </a>
          </div>

          <div class="header-stack">
            <div class="header-actions" aria-label="Management actions">
              <div class="secondary-actions" aria-label="Secondary actions">
                <button class="button button-ghost" type="button" data-action="open-team">
                  ${icon('users')}
                  <span>Team Members</span>
                </button>
                <button class="button button-ghost" type="button" data-action="open-projects">
                  ${icon('folder')}
                  <span>Projects</span>
                </button>
                <button class="button button-ghost" type="button" data-action="export-data">
                  ${icon('download')}
                  <span>Export JSON</span>
                </button>
                <button class="button button-ghost" type="button" data-action="import-data">
                  ${icon('upload')}
                  <span>Import JSON</span>
                </button>
              </div>
              <button class="button button-primary header-primary-action" type="button" data-action="open-add-subscription">
                ${icon('plus')}
                <span>Add Subscription</span>
              </button>
              <input class="visually-hidden" type="file" accept="application/json,.json" data-action="import-data-file" />
            </div>
          </div>
        </header>

        <main class="dashboard-grid">
          <div class="workspace-column">
            ${renderStats(totals)}

            <section class="workspace" aria-label="Subscription workspace">
              <div class="subscription-panel">
                ${renderToolbar()}
                <div class="subscription-results">
                  ${ui.loading ? renderSkeleton() : renderSubscriptionResults(filteredSubscriptions)}
                </div>
              </div>
            </section>
          </div>

          <aside class="insight-rail" aria-label="Subscription insights">
            ${renderReimbursementStatus()}
            ${renderTeamPanel()}
            ${renderReimbursementPanel()}
            ${renderRecentActivity()}
          </aside>
        </main>

        <footer class="tdri-footer">
          <strong>TDRI</strong>
          <span>TDRI envisions a prosperous Thailand driven by high-quality research and effective policy recommendations.</span>
          <div class="city-line" aria-hidden="true"></div>
        </footer>
      </div>

      <div class="toast ${ui.toast ? 'is-visible' : ''}" role="status">${ui.toast}</div>
      ${renderModal()}
    </div>
  `;
}

function renderStats(totals) {
  return `
    <h2 class="mobile-section-title">Overview</h2>
    <div class="metric-grid" aria-label="Summary metrics">
      <article class="metric-card">
        <span class="metric-icon metric-icon-blue">${icon('bookmark')}</span>
        <span class="metric-label">Total Subscriptions</span>
        <strong>${totals.subscriptions}</strong>
        <small>Active services</small>
      </article>
      <article class="metric-card">
        <span class="metric-icon metric-icon-violet">${icon('coin')}</span>
        <span class="metric-label">Monthly Cost</span>
        <strong>${formatMoney(totals.monthly, true)}</strong>
        <small>Recurring estimate</small>
      </article>
      <article class="metric-card">
        <span class="metric-icon metric-icon-green">${icon('trend')}</span>
        <span class="metric-label">Cumulative Cost</span>
        <strong>${formatMoney(totals.cumulative, true)}</strong>
        <small>All time</small>
      </article>
    </div>
  `;
}

function renderToolbar() {
  const filters = ['All', 'Pending', 'Done'];

  return `
    <div class="table-toolbar">
      <div class="search-box">
        ${icon('search')}
        <input type="search" value="${escapeAttribute(ui.query)}" placeholder="Search product, credential, or project" aria-label="Search subscriptions" data-action="search" />
      </div>
      <button class="filter-button" type="button" aria-label="Cycle subscription filter, current filter is ${escapeAttribute(ui.filter)}" title="Cycle filter" data-action="cycle-filter">
        ${icon('filter')}
      </button>
      <div class="segmented-control" aria-label="Filter subscriptions">
        ${filters
          .map(
            (filter) => `
              <button class="${ui.filter === filter ? 'is-active' : ''}" type="button" data-action="set-filter" data-filter="${filter}">
                ${filter}
              </button>
            `,
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderSkeleton() {
  return `
    <div class="ledger-table" aria-label="Loading subscriptions">
      <div class="ledger-head">
        <span></span><span>Product</span><span>Credentials</span><span>Payment Type</span><span>Total Cost</span><span>Last Payment</span><span>Actions</span>
      </div>
      ${Array.from({ length: 7 })
        .map(
          (_, index) => `
            <div class="skeleton-row" style="--index: ${index}">
              <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderSubscriptionTable(subscriptions) {
  if (!subscriptions.length) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">${icon('vault')}</div>
        <h2>No matching subscriptions</h2>
        <p>Adjust the filter or add a new subscription record for the team.</p>
        <button class="button button-primary" type="button" data-action="open-add-subscription">
          ${icon('plus')}
          <span>Add Subscription</span>
        </button>
      </div>
    `;
  }

  return `
    <div class="ledger-table" role="table" aria-label="Team subscriptions">
      <div class="ledger-head" role="row">
        <span></span>
        <span>${renderSortButton('product', 'Product')}</span>
        <span>Credentials</span>
        <span>Payment Type</span>
        <span>${renderSortButton('totalCost', 'Total Cost')}</span>
        <span>${renderSortButton('lastPayment', 'Last Payment')}</span>
        <span>Actions</span>
      </div>
      ${subscriptions.map(renderSubscription).join('')}
    </div>
  `;
}

function renderSortButton(key, label) {
  const isActive = ui.sortKey === key;
  const direction = isActive ? ui.sortDirection : 'none';

  return `
    <button class="sort-button ${isActive ? 'is-active' : ''}" type="button" data-action="sort-table" data-sort-key="${key}" aria-sort="${direction}">
      <span>${label}</span>
      ${icon(isActive && ui.sortDirection === 'desc' ? 'sortDesc' : 'sort')}
    </button>
  `;
}

function renderSubscriptionResults(subscriptions) {
  return `
    ${renderSubscriptionTable(subscriptions)}
    ${subscriptions.length ? renderTableSummary(subscriptions.length) : ''}
  `;
}

function renderTableSummary(totalCount) {
  return `
    <div class="table-summary">
      Showing ${totalCount} subscription${totalCount === 1 ? '' : 's'}
    </div>
  `;
}

function renderSubscription(subscription, index) {
  const latest = getLatestPayment(subscription);
  const total = getSubscriptionTotal(subscription);
  const isFree = subscription.paymentType === 'Free';
  const isPasswordVisible = ui.visiblePasswords.has(subscription.id);

  return `
    <article class="subscription-group ${subscription.expanded ? 'is-expanded' : ''}" style="--index: ${index}">
      <div class="subscription-row">
        <button class="icon-button disclosure" type="button" aria-label="Toggle ${escapeAttribute(subscription.product)} details" data-action="toggle-subscription" data-id="${subscription.id}">
          ${icon('chevron')}
        </button>

        <div class="product-cell" data-label="Product">
          <span>
            <strong>${escapeHtml(subscription.product)}</strong>
          </span>
        </div>

        <div class="credential-cell" data-label="Credentials">
          <div class="credential-stack">
            <span class="credential-line">
              <code>${escapeHtml(subscription.credential)}</code>
              <button class="inline-icon" type="button" aria-label="Copy credential" title="Copy credential" data-action="copy-credential" data-value="${escapeAttribute(subscription.credential)}">
                ${icon('copy')}
              </button>
            </span>
            ${
              subscription.password
                ? `
            <span class="credential-line credential-line-password">
              <code class="password-code ${isPasswordVisible ? 'is-revealed' : ''}">${escapeHtml(displayedPassword(subscription))}</code>
              <button class="inline-icon" type="button" aria-label="${isPasswordVisible ? 'Hide' : 'Show'} password" title="${isPasswordVisible ? 'Hide password' : 'Show password'}" data-action="toggle-password-visibility" data-id="${subscription.id}">
                ${icon(isPasswordVisible ? 'eyeOff' : 'eye')}
              </button>
              <button class="inline-icon" type="button" aria-label="Copy password" title="Copy password" data-action="copy-password" data-value="${escapeAttribute(subscription.password)}">
                ${icon('copy')}
              </button>
            </span>`
                : ''
            }
            ${subscription.credentialNote ? `<small>${escapeHtml(subscription.credentialNote)}</small>` : ''}
          </div>
        </div>

        <div data-label="Payment Type">
          <span class="chip chip-${chipTone(subscription.paymentType)}">${escapeHtml(subscription.paymentType)}</span>
        </div>

        <div class="money-stack" data-label="Total Cost">
          <strong>${isFree ? '-' : formatMoney(total, true)}</strong>
          <small>
            ${
              isFree
                ? 'No payments'
                : `${subscription.payments.length} payment${subscription.payments.length === 1 ? '' : 's'}`
            }
          </small>
        </div>

        <div class="date-cell" data-label="Last Payment">
          <span class="date-status-row">
            <strong>${isFree ? '-' : latest ? formatDate(latest.date) : 'No payments'}</strong>
            <small>${isFree ? 'None' : latest ? latest.status : 'Empty'}</small>
          </span>
        </div>

        <div class="row-actions" data-label="Actions">
          <button class="inline-icon" type="button" aria-label="Edit subscription" title="Edit subscription" data-action="open-edit-subscription" data-id="${subscription.id}">
            ${icon('edit')}
            <span class="action-label">Edit</span>
          </button>
          <button class="inline-icon danger" type="button" aria-label="Delete subscription" title="Delete subscription" data-action="delete-subscription" data-id="${subscription.id}">
            ${icon('trash')}
            <span class="action-label">Delete</span>
          </button>
        </div>
      </div>

      ${subscription.expanded ? renderPaymentHistory(subscription) : ''}
    </article>
  `;
}

function renderPaymentHistory(subscription) {
  const payments = [...subscription.payments].sort((a, b) => new Date(b.date) - new Date(a.date));

  return `
    <section class="payment-history" aria-label="${escapeAttribute(subscription.product)} payment history">
      <div class="history-header">
        <h2>Payment History</h2>
        <button class="button button-primary button-compact" type="button" data-action="open-add-payment" data-id="${subscription.id}">
          ${icon('plus')}
          <span>Add Payment</span>
        </button>
      </div>
      <div class="payment-list">
        ${payments
          .map(
            (payment) => `
              <div class="payment-card">
                <div>
                  <span>Date</span>
                  <strong>${formatDate(payment.date)}</strong>
                </div>
                <div>
                  <span>Paid By</span>
                  <strong>${escapeHtml(getMember(payment.paidBy).name)}</strong>
                </div>
                <div>
                  <span>Type</span>
                  <span class="chip chip-${chipTone(payment.type)}">${escapeHtml(payment.type)}</span>
                </div>
                <div>
                  <span>Amount</span>
                  <strong>${formatMoney(payment.amount, true)}</strong>
                </div>
                <div>
                  <span>Currency</span>
                  <strong>${escapeHtml(payment.currency)}</strong>
                </div>
                <div>
                  <span>Reimbursement</span>
                  ${
                    payment.reimbursement === 'Project' && payment.projectId
                      ? `<strong>${escapeHtml(getProject(payment.projectId)?.code || 'Project')}</strong>`
                      : `<strong>${escapeHtml(payment.reimbursement || 'None')}</strong>`
                  }
                </div>
                <div>
                  <label for="status-${payment.id}">Status</label>
                  <select id="status-${payment.id}" data-action="update-payment-status" data-subscription-id="${subscription.id}" data-payment-id="${payment.id}">
                    <option value="Pending" ${payment.status === 'Pending' ? 'selected' : ''}>Pending</option>
                    <option value="Done" ${payment.status === 'Done' ? 'selected' : ''}>Done</option>
                  </select>
                </div>
                <div class="payment-actions">
                  <button class="inline-icon" type="button" aria-label="Edit payment" title="Edit payment" data-action="open-edit-payment" data-subscription-id="${subscription.id}" data-payment-id="${payment.id}">
                    ${icon('edit')}
                  </button>
                  <button class="inline-icon" type="button" aria-label="Duplicate payment" title="Duplicate payment" data-action="duplicate-payment" data-subscription-id="${subscription.id}" data-payment-id="${payment.id}">
                    ${icon('copy')}
                  </button>
                  <button class="inline-icon danger" type="button" aria-label="Delete payment" title="Delete payment" data-action="delete-payment" data-subscription-id="${subscription.id}" data-payment-id="${payment.id}">
                    ${icon('trash')}
                  </button>
                </div>
              </div>
            `,
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderReimbursementStatus() {
  const totals = getStatusTotals();
  const total = totals.Pending + totals.Done;
  const donePercent = total ? Math.round((totals.Done / total) * 100) : 0;

  return `
    <section class="rail-panel">
      <h2>Reimbursement Status</h2>
      <div class="status-line">
        <span class="status-icon pending">${icon('clock')}</span>
        <span>Pending</span>
        <strong>${formatMoney(totals.Pending, true)}</strong>
      </div>
      <div class="status-line">
        <span class="status-icon done">${icon('check')}</span>
        <span>Done</span>
        <strong>${formatMoney(totals.Done, true)}</strong>
      </div>
      <div class="status-progress" aria-label="${donePercent}% reimbursed">
        <span style="width: ${donePercent}%"></span>
        <strong>${donePercent}%</strong>
      </div>
    </section>
  `;
}

function renderTeamPanel() {
  return `
    <section class="rail-panel">
      <div class="panel-header">
        <h2>By Team Member</h2>
        <button class="text-link" type="button" data-action="open-team">View all</button>
      </div>
      ${summarizeByTeam()
        .map(
          (member) => `
            <div class="member-line">
              <span class="avatar" style="--avatar-color: ${member.color}">${member.name[0]}</span>
              <span>
                <strong>${escapeHtml(member.name)}</strong>
              </span>
              <strong>${formatMoney(member.total, true)}</strong>
            </div>
          `,
        )
        .join('')}
    </section>
  `;
}

function renderReimbursementPanel() {
  const reimbursement = summarizeByReimbursement();
  const projects = summarizeByProject().filter((project) => project.total > 0);

  return `
    <section class="rail-panel">
      <div class="panel-header">
        <h2>By Reimbursement</h2>
        <button class="text-link" type="button" data-action="open-projects">View all</button>
      </div>
      <div class="status-line">
        <span class="status-icon fund">${icon('building')}</span>
        <span>
          <strong>Fund</strong>
          <small>
            ${
              state.subscriptions
                .flatMap((subscription) => subscription.payments)
                .filter((payment) => payment.reimbursement === 'Fund').length
            } payments
          </small>
        </span>
        <strong>${formatMoney(reimbursement.Fund, true)}</strong>
      </div>
      <div class="rail-divider"></div>
      <p class="rail-kicker">${icon('beaker')} Projects</p>
      ${projects
        .map(
          (project) => `
            <div class="project-line">
              <span class="project-dot" style="--project-color: ${project.color}"></span>
              <span>
                <strong>${escapeHtml(project.code)}</strong>
                <small>${project.payments} payments</small>
              </span>
              <strong>${formatMoney(project.total, true)}</strong>
            </div>
          `,
        )
        .join('')}
    </section>
  `;
}

function renderRecentActivity() {
  const latestActivity = state.subscriptions
    .flatMap((subscription) =>
      subscription.payments.map((payment) => ({
        subscription,
        payment,
      })),
    )
    .sort((a, b) => new Date(b.payment.date) - new Date(a.payment.date))[0];

  if (!latestActivity) {
    return '';
  }

  return `
    <section class="rail-panel recent-activity">
      <div class="panel-header">
        <h2>Recent Activity</h2>
        <button class="text-link" type="button" data-action="set-filter" data-filter="All">View all</button>
      </div>
      <div class="activity-line">
        <span class="status-icon done">${icon('check')}</span>
        <span>
          <strong>Payment added</strong>
          <small>${escapeHtml(latestActivity.subscription.product)} - ${escapeHtml(latestActivity.payment.type)} payment</small>
        </span>
        <time>${formatDate(latestActivity.payment.date)}</time>
      </div>
    </section>
  `;
}

function renderModal() {
  if (!ui.modal) {
    return '';
  }

  if (ui.modal.type === 'team') {
    return renderTeamModal();
  }

  if (ui.modal.type === 'projects') {
    return renderProjectsModal();
  }

  if (ui.modal.type === 'addPayment') {
    return renderPaymentModal(ui.modal.subscriptionId);
  }

  if (ui.modal.type === 'editPayment') {
    return renderPaymentModal(ui.modal.subscriptionId, ui.modal.paymentId);
  }

  if (ui.modal.type === 'subscription' || ui.modal.type === 'editSubscription') {
    return renderSubscriptionModal(ui.modal.subscriptionId);
  }

  return '';
}

function renderSubscriptionModal(subscriptionId) {
  const isEdit = Boolean(subscriptionId);
  const subscription = isEdit
    ? state.subscriptions.find((item) => item.id === subscriptionId)
    : {
        product: '',
        credential: '',
        password: '',
        credentialNote: '',
        status: 'Active',
        paymentType: 'Monthly',
        ownerId: state.team[0]?.id,
        monthlyEquivalent: '',
      };

  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal subscription-modal" role="dialog" aria-modal="true" aria-labelledby="subscription-title" data-modal>
        <div class="modal-header">
          <h2 id="subscription-title">${isEdit ? 'Edit Subscription' : 'Add Subscription'}</h2>
          <button class="inline-icon" type="button" aria-label="Close dialog" data-action="close-modal">${icon('x')}</button>
        </div>
        ${renderFormError()}
        <form class="subscription-form" data-action="${isEdit ? 'save-subscription-edit' : 'save-subscription'}" data-id="${subscriptionId || ''}">
          <div class="form-grid">
            ${inputField('product', 'Product Name', subscription.product, 'e.g. Notion, Figma, GitHub', 'text', '', false)}
            ${inputField('credential', 'Email or username', subscription.credential, 'Account email, username, or phone number', 'text', '', false)}
            ${inputField('password', 'Password', subscription.password, 'Account password', 'text', '', false)}
            ${textareaField('credentialNote', 'Note', subscription.credentialNote, 'Any credentials info, product details, license info')}
          </div>

          <div class="modal-section">
            <h3>Subscription Type</h3>
            <div class="form-grid">
              ${selectField('status', 'Status', ['Active', 'Paused', 'Cancelled'], subscription.status || 'Active')}
              ${selectField('paymentType', 'Type', ['Monthly', 'Annually', 'One Time', 'Free'], subscription.paymentType)}
            </div>
          </div>

          <div class="form-actions">
            <button class="button button-ghost" type="button" data-action="close-modal">Cancel</button>
            <button class="button button-primary" type="submit">Done</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderPaymentModal(subscriptionId, paymentId = '') {
  const subscription = state.subscriptions.find((item) => item.id === subscriptionId);
  const payment = paymentId ? subscription.payments.find((item) => item.id === paymentId) : null;
  const isEdit = Boolean(payment);
  const today = new Date().toISOString().slice(0, 10);
  const paymentTypeOptions = ['Monthly', 'Annually', 'One Time'];
  const paymentType = paymentTypeOptions.includes(payment?.type || subscription.paymentType)
    ? payment?.type || subscription.paymentType
    : 'Monthly';

  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="payment-title" data-modal>
        <div class="modal-header">
          <div>
            <p class="system-label">${escapeHtml(subscription.product)}</p>
            <h2 id="payment-title">${isEdit ? 'Edit Payment' : 'Add Payment'}</h2>
          </div>
          <button class="inline-icon" type="button" aria-label="Close dialog" data-action="close-modal">${icon('x')}</button>
        </div>
        ${renderFormError()}
        <form class="form-grid" data-action="${isEdit ? 'save-payment-edit' : 'save-payment'}" data-id="${subscriptionId}" data-payment-id="${paymentId}">
          ${inputField('date', 'Date', payment?.date || today, '', 'date')}
          ${selectObjectField('paidBy', 'Paid by', state.team, payment?.paidBy || subscription.ownerId, 'name')}
          ${selectField('type', 'Type', paymentTypeOptions, paymentType)}
          ${inputField('amount', 'Amount', payment?.amount ?? '', '1850.00', 'number', '0.01')}
          ${selectField('reimbursement', 'Reimbursement Type', ['Fund', 'Project', 'None'], payment?.reimbursement || 'Fund')}
          ${selectObjectField('projectId', 'Project Name', state.projects, payment?.projectId || state.projects[0]?.id, 'code', 'name', 'project-field')}
          ${selectField('currency', 'Currency', ['THB', 'USD'], payment?.currency || 'THB')}
          ${selectField('status', 'Status', ['Pending', 'Done'], payment?.status || 'Pending')}
          <div class="form-actions">
            <button class="button button-ghost" type="button" data-action="close-modal">Cancel</button>
            <button class="button button-primary" type="submit">${isEdit ? 'Done' : 'Add Payment'}</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderTeamModal() {
  const editingMemberId = ui.modal?.editingMemberId || '';

  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal side-modal team-modal" role="dialog" aria-modal="true" aria-labelledby="team-title" data-modal>
        <div class="modal-header">
          <h2 id="team-title">Manage Team Members</h2>
          <button class="inline-icon" type="button" aria-label="Close dialog" data-action="close-modal">${icon('x')}</button>
        </div>
        <form class="team-add-form" data-action="save-member">
          <label>
            <span>Add New Member</span>
            <div class="team-add-row">
              <input name="name" placeholder="Enter member name" required />
              <button class="button button-primary" type="submit">${icon('plus')} <span>Add</span></button>
            </div>
          </label>
        </form>
        ${renderFormError()}
        <h3 class="team-list-title">Team Members (${state.team.length})</h3>
        <div class="management-list">
          ${summarizeByTeam()
            .map(
              (member) => `
                ${editingMemberId === member.id ? renderMemberEditRow(member) : renderMemberRow(member)}
              `,
            )
            .join('')}
        </div>
        <div class="team-modal-footer">
          <button class="button button-primary" type="button" data-action="close-modal">Done</button>
        </div>
      </section>
    </div>
  `;
}

function renderMemberRow(member) {
  return `
    <div class="management-row team-member-row">
      <span class="avatar" style="--avatar-color: ${member.color}">${member.name[0]}</span>
      <strong>${escapeHtml(member.name)}</strong>
      <div class="management-actions">
        <button class="inline-icon" type="button" aria-label="Edit ${escapeAttribute(member.name)}" title="Edit member" data-action="edit-member" data-id="${member.id}">
          ${icon('edit')}
        </button>
        <button class="inline-icon danger" type="button" aria-label="Delete ${escapeAttribute(member.name)}" title="Delete member" data-action="delete-member" data-id="${member.id}">
          ${icon('trash')}
        </button>
      </div>
    </div>
  `;
}

function renderMemberEditRow(member) {
  return `
    <form class="management-row team-member-row is-editing" data-action="save-member-edit" data-id="${member.id}">
      <span class="avatar" style="--avatar-color: ${member.color}">${member.name[0]}</span>
      <input name="name" value="${escapeAttribute(member.name)}" aria-label="Member name" required />
      <div class="management-actions">
        <button class="inline-icon" type="submit" aria-label="Save member" title="Save member">${icon('check')}</button>
        <button class="inline-icon" type="button" aria-label="Cancel edit" title="Cancel edit" data-action="cancel-member-edit">${icon('x')}</button>
      </div>
    </form>
  `;
}

function renderProjectViewRow(project) {
  return `
    <div class="management-row project-row">
      <span class="project-dot large" style="--project-color: ${project.color}"></span>
      <span>
        <strong>${escapeHtml(project.code)} | ${escapeHtml(project.name)}</strong>
        <small>${formatMoney(project.total, true)} across ${project.payments} payments</small>
      </span>
      <div class="management-actions">
        <button class="inline-icon" type="button" aria-label="Edit project" title="Edit project" data-action="edit-project" data-id="${project.id}">
          ${icon('edit')}
        </button>
        <button class="inline-icon danger" type="button" aria-label="Delete project" title="Delete project" data-action="delete-project" data-id="${project.id}">
          ${icon('trash')}
        </button>
      </div>
    </div>
  `;
}

function renderProjectEditRow(project) {
  return `
    <form class="management-row project-row is-editing" data-action="save-project-edit" data-id="${project.id}">
      <span class="project-dot large" style="--project-color: ${project.color}"></span>
      <div class="inline-form-grid">
        <label>
          <span>Code</span>
          <input name="code" value="${escapeAttribute(project.code)}" maxlength="5" required />
        </label>
        <label>
          <span>Project name</span>
          <input name="name" value="${escapeAttribute(project.name)}" required />
        </label>
      </div>
      <div class="management-actions">
        <button class="inline-icon" type="submit" aria-label="Save project" title="Save project">${icon('check')}</button>
        <button class="inline-icon" type="button" aria-label="Cancel edit" title="Cancel edit" data-action="cancel-project-edit">${icon('x')}</button>
      </div>
    </form>
  `;
}

function renderProjectsModal() {
  const projects = summarizeByProject();
  const editingProjectId = ui.modal.editingProjectId;

  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal side-modal" role="dialog" aria-modal="true" aria-labelledby="projects-title" data-modal>
        <div class="modal-header">
          <div>
            <p class="system-label">Reimbursement mapping</p>
            <h2 id="projects-title">Projects</h2>
          </div>
          <button class="inline-icon" type="button" aria-label="Close dialog" data-action="close-modal">${icon('x')}</button>
        </div>
        <div class="management-list">
          ${projects
            .map((project) => (editingProjectId === project.id ? renderProjectEditRow(project) : renderProjectViewRow(project)))
            .join('')}
        </div>
        ${renderFormError()}
        <form class="inline-form" data-action="save-project">
          <label>
            <span>Code</span>
            <input name="code" placeholder="HA" maxlength="5" required />
          </label>
          <label>
            <span>Project name</span>
            <input name="name" placeholder="Project name" required />
          </label>
          <button class="button button-primary" type="submit">${icon('plus')} Add Project</button>
        </form>
      </section>
    </div>
  `;
}

function renderFormError() {
  return ui.formError ? `<p class="form-error">${escapeHtml(ui.formError)}</p>` : '';
}

function inputField(name, label, value, placeholder, type = 'text', step = '', required = true) {
  return `
    <label class="field">
      <span>${label}</span>
      <input name="${name}" type="${type}" value="${escapeAttribute(value ?? '')}" placeholder="${placeholder}" ${step ? `step="${step}"` : ''} ${required ? 'required' : ''} />
    </label>
  `;
}

function selectField(name, label, options, value) {
  return `
    <label class="field">
      <span>${label}</span>
      <select name="${name}">
        ${options.map((option) => `<option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>`).join('')}
      </select>
    </label>
  `;
}

function textareaField(name, label, value, placeholder) {
  return `
    <label class="field field-full">
      <span>${label}</span>
      <textarea name="${name}" placeholder="${placeholder}">${escapeHtml(value ?? '')}</textarea>
    </label>
  `;
}

function selectObjectField(name, label, options, value, primaryKey, secondaryKey, className = '') {
  return `
    <label class="field ${className}">
      <span>${label}</span>
      <select name="${name}">
        <option value="">Select ${label.toLowerCase()}</option>
        ${options
          .map(
            (option) => `
              <option value="${option.id}" ${option.id === value ? 'selected' : ''}>
                ${escapeHtml(option[primaryKey])}${secondaryKey && option[secondaryKey] ? ` | ${escapeHtml(option[secondaryKey])}` : ''}
              </option>
            `,
          )
          .join('')}
      </select>
    </label>
  `;
}

document.addEventListener('click', async (event) => {
  const control = event.target.closest('[data-action]');
  if (!control) {
    return;
  }

  const action = control.dataset.action;

  if (action === 'close-modal' && (!event.target.closest('[data-modal]') || control.matches('button'))) {
    closeModal();
  }

  if (action === 'toggle-subscription') {
    toggleSubscription(control.dataset.id);
  }

  if (action === 'set-filter') {
    ui.filter = control.dataset.filter;
    render();
  }

  if (action === 'cycle-filter') {
    const filters = ['All', 'Pending', 'Done'];
    const currentIndex = filters.indexOf(ui.filter);
    ui.filter = filters[(currentIndex + 1) % filters.length];
    render();
  }

  if (action === 'sort-table') {
    const nextKey = control.dataset.sortKey;
    ui.sortDirection = ui.sortKey === nextKey && ui.sortDirection === 'asc' ? 'desc' : 'asc';
    ui.sortKey = nextKey;
    renderSearchResults();
  }

  if (action === 'open-add-subscription') {
    openModal({ type: 'subscription' });
  }

  if (action === 'open-edit-subscription') {
    openModal({ type: 'editSubscription', subscriptionId: control.dataset.id });
  }

  if (action === 'open-add-payment') {
    openModal({ type: 'addPayment', subscriptionId: control.dataset.id });
  }

  if (action === 'open-edit-payment') {
    openModal({
      type: 'editPayment',
      subscriptionId: control.dataset.subscriptionId,
      paymentId: control.dataset.paymentId,
    });
  }

  if (action === 'open-team') {
    openModal({ type: 'team' });
  }

  if (action === 'edit-member') {
    openModal({ type: 'team', editingMemberId: control.dataset.id });
  }

  if (action === 'cancel-member-edit') {
    openModal({ type: 'team' });
  }

  if (action === 'open-projects') {
    openModal({ type: 'projects' });
  }

  if (action === 'export-data') {
    exportLedgerData();
  }

  if (action === 'import-data') {
    document.querySelector('[data-action="import-data-file"]')?.click();
  }

  if (action === 'edit-project') {
    openModal({ type: 'projects', editingProjectId: control.dataset.id });
  }

  if (action === 'cancel-project-edit') {
    openModal({ type: 'projects' });
  }

  if (action === 'copy-credential') {
    await copyText(control.dataset.value, 'Credential copied');
  }

  if (action === 'copy-password') {
    await copyText(control.dataset.value, 'Password copied');
  }

  if (action === 'toggle-password-visibility') {
    togglePasswordVisibility(control.dataset.id, control);
  }

  if (action === 'duplicate-payment') {
    duplicatePayment(control.dataset.subscriptionId, control.dataset.paymentId);
  }

  if (action === 'delete-payment') {
    deletePayment(control.dataset.subscriptionId, control.dataset.paymentId);
  }

  if (action === 'delete-subscription') {
    deleteSubscription(control.dataset.id);
  }

  if (action === 'delete-member') {
    deleteMember(control.dataset.id);
  }

  if (action === 'delete-project') {
    deleteProject(control.dataset.id);
  }
});

document.addEventListener('input', (event) => {
  const control = event.target.closest('[data-action="search"]');
  if (!control) {
    return;
  }

  ui.query = control.value;
  window.clearTimeout(searchRenderTimer);
  searchRenderTimer = window.setTimeout(renderSearchResults, 180);
});

function renderSearchResults() {
  const results = document.querySelector('.subscription-results');
  if (!results) {
    render();
    return;
  }

  results.innerHTML = renderSubscriptionResults(getFilteredSubscriptions());
}

document.addEventListener('change', async (event) => {
  const importControl = event.target.closest('[data-action="import-data-file"]');
  if (importControl) {
    await importLedgerData(importControl.files?.[0]);
    importControl.value = '';
    return;
  }

  const control = event.target.closest('[data-action="update-payment-status"]');
  if (control) {
    updatePaymentStatus(control.dataset.subscriptionId, control.dataset.paymentId, control.value);
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-action]');
  if (!form) {
    return;
  }

  event.preventDefault();
  const action = form.dataset.action;

  if (action === 'save-subscription') {
    saveSubscription(form);
  }

  if (action === 'save-subscription-edit') {
    saveSubscription(form, form.dataset.id);
  }

  if (action === 'save-payment') {
    savePayment(form, form.dataset.id);
  }

  if (action === 'save-payment-edit') {
    savePayment(form, form.dataset.id, form.dataset.paymentId);
  }

  if (action === 'save-member') {
    saveMember(form);
  }

  if (action === 'save-member-edit') {
    saveMemberEdit(form, form.dataset.id);
  }

  if (action === 'save-project') {
    saveProject(form);
  }

  if (action === 'save-project-edit') {
    saveProjectEdit(form, form.dataset.id);
  }
});

function openModal(modal) {
  ui.modal = modal;
  ui.formError = '';
  render();
}

function closeModal() {
  ui.modal = null;
  ui.formError = '';
  render();
}

function toggleSubscription(id) {
  state.subscriptions = state.subscriptions.map((subscription) =>
    subscription.id === id ? { ...subscription, expanded: !subscription.expanded } : subscription,
  );
  saveState();
  render();
}

function updatePaymentStatus(subscriptionId, paymentId, status) {
  state.subscriptions = state.subscriptions.map((subscription) => {
    if (subscription.id !== subscriptionId) {
      return subscription;
    }

    return {
      ...subscription,
      payments: subscription.payments.map((payment) => (payment.id === paymentId ? { ...payment, status } : payment)),
    };
  });
  saveState();
  showToast(`Payment marked ${status.toLowerCase()}`);
}

function togglePasswordVisibility(subscriptionId, control) {
  const subscription = state.subscriptions.find((item) => item.id === subscriptionId);
  if (!subscription?.password) {
    return;
  }

  if (ui.visiblePasswords.has(subscriptionId)) {
    ui.visiblePasswords.delete(subscriptionId);
  } else {
    ui.visiblePasswords.add(subscriptionId);
  }

  const isPasswordVisible = ui.visiblePasswords.has(subscriptionId);
  const passwordLine = control.closest('.credential-line');
  const passwordCode = passwordLine?.querySelector('.password-code');

  if (passwordCode) {
    passwordCode.textContent = displayedPassword(subscription);
    passwordCode.classList.toggle('is-revealed', isPasswordVisible);
  }

  control.setAttribute('aria-label', `${isPasswordVisible ? 'Hide' : 'Show'} password`);
  control.setAttribute('title', `${isPasswordVisible ? 'Hide' : 'Show'} password`);
  control.innerHTML = icon(isPasswordVisible ? 'eyeOff' : 'eye');
}

function saveSubscription(form, subscriptionId = '') {
  const data = Object.fromEntries(new FormData(form));
  const isFree = data.paymentType === 'Free';

  if (subscriptionId) {
    state.subscriptions = state.subscriptions.map((subscription) =>
      subscription.id === subscriptionId
        ? (() => {
            const { vendor, ...subscriptionWithoutVendor } = subscription;
            return {
              ...subscriptionWithoutVendor,
              product: data.product.trim(),
              credential: data.credential.trim(),
              password: data.password.trim(),
              credentialNote: data.credentialNote.trim(),
              status: data.status || 'Active',
              paymentType: data.paymentType,
              monthlyEquivalent: subscription.monthlyEquivalent || 0,
              payments: isFree ? [] : subscription.payments,
            };
          })()
        : subscription,
    );
    showToast('Subscription updated');
  } else {
    const id = createId(data.product || 'subscription');
    state.subscriptions.unshift({
      id,
      product: data.product.trim(),
      credential: data.credential.trim(),
      password: data.password.trim(),
      credentialNote: data.credentialNote.trim(),
      status: data.status || 'Active',
      paymentType: data.paymentType,
      ownerId: state.team[0]?.id || '',
      monthlyEquivalent: 0,
      expanded: true,
      payments: [],
    });
    showToast('Subscription created');
  }

  saveState();
  closeModal();
}

function savePayment(form, subscriptionId, paymentId = '') {
  const data = Object.fromEntries(new FormData(form));
  const amount = Number(data.amount);

  if (!data.date || Number.isNaN(amount) || amount <= 0) {
    ui.formError = 'Payment date and a positive amount are required.';
    render();
    return;
  }

  state.subscriptions = state.subscriptions.map((subscription) => {
    if (subscription.id !== subscriptionId) {
      return subscription;
    }

    const reimbursement = data.reimbursement || 'Fund';
    const projectId = reimbursement === 'Project' ? data.projectId || state.projects[0]?.id || '' : '';

    const paymentRecord = {
      date: data.date,
      paidBy: data.paidBy,
      type: data.type,
      amount,
      currency: data.currency,
      status: data.status,
      reimbursement,
      projectId,
    };

    if (paymentId) {
      return {
        ...subscription,
        expanded: true,
        payments: subscription.payments.map((payment) =>
          payment.id === paymentId ? { ...payment, ...paymentRecord } : payment,
        ),
      };
    }

    return {
      ...subscription,
      expanded: true,
      payments: [
        {
          id: `pay-${Date.now()}`,
          ...paymentRecord,
        },
        ...subscription.payments,
      ],
    };
  });

  saveState();
  showToast(paymentId ? 'Payment updated' : 'Payment added');
  closeModal();
}

function saveMember(form) {
  const data = Object.fromEntries(new FormData(form));
  const name = data.name.trim();

  if (!name) {
    ui.formError = 'Member name is required.';
    render();
    return;
  }

  state.team.push({
    id: createId(name),
    name,
    role: '',
    color: pickColor(state.team.length),
  });

  saveState();
  showToast('Team member added');
  openModal({ type: 'team' });
}

function saveMemberEdit(form, memberId) {
  const data = Object.fromEntries(new FormData(form));
  const name = data.name.trim();

  if (!name) {
    ui.formError = 'Member name is required.';
    ui.modal = { type: 'team', editingMemberId: memberId };
    render();
    return;
  }

  state.team = state.team.map((member) => (member.id === memberId ? { ...member, name } : member));
  saveState();
  showToast('Team member updated');
  openModal({ type: 'team' });
}

function deleteMember(memberId) {
  const isInUse = state.subscriptions.some(
    (subscription) =>
      subscription.ownerId === memberId || subscription.payments.some((payment) => payment.paidBy === memberId),
  );

  if (state.team.length <= 1 || isInUse) {
    ui.formError = isInUse
      ? 'This member is linked to subscription or payment records.'
      : 'At least one team member is required.';
    ui.modal = { type: 'team' };
    render();
    return;
  }

  state.team = state.team.filter((member) => member.id !== memberId);
  saveState();
  showToast('Team member removed');
  openModal({ type: 'team' });
}

function saveProject(form) {
  const data = Object.fromEntries(new FormData(form));
  const code = data.code.trim().toUpperCase();
  const name = data.name.trim();

  if (!code || !name) {
    ui.formError = 'Code and project name are required.';
    render();
    return;
  }

  state.projects.push({
    id: createId(code),
    code,
    name,
    color: pickColor(state.projects.length + 2),
  });

  saveState();
  showToast('Project added');
  openModal({ type: 'projects' });
}

function saveProjectEdit(form, projectId) {
  const data = Object.fromEntries(new FormData(form));
  const code = data.code.trim().toUpperCase();
  const name = data.name.trim();

  if (!code || !name) {
    ui.formError = 'Code and project name are required.';
    ui.modal = { type: 'projects', editingProjectId: projectId };
    render();
    return;
  }

  const hasDuplicateCode = state.projects.some(
    (project) => project.id !== projectId && project.code.toUpperCase() === code,
  );

  if (hasDuplicateCode) {
    ui.formError = 'Project code already exists.';
    ui.modal = { type: 'projects', editingProjectId: projectId };
    render();
    return;
  }

  state.projects = state.projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          code,
          name,
        }
      : project,
  );

  saveState();
  showToast('Project updated');
  openModal({ type: 'projects' });
}

function deleteProject(projectId) {
  const isInUse = state.subscriptions.some((subscription) =>
    subscription.payments.some((payment) => payment.projectId === projectId),
  );

  if (state.projects.length <= 1 || isInUse) {
    ui.formError = isInUse
      ? 'This project is linked to subscriptions. Reassign them first.'
      : 'At least one project is required.';
    ui.modal = { type: 'projects' };
    render();
    return;
  }

  state.projects = state.projects.filter((project) => project.id !== projectId);
  saveState();
  showToast('Project removed');
  openModal({ type: 'projects' });
}

function duplicatePayment(subscriptionId, paymentId) {
  state.subscriptions = state.subscriptions.map((subscription) => {
    if (subscription.id !== subscriptionId) {
      return subscription;
    }

    const source = subscription.payments.find((payment) => payment.id === paymentId);
    if (!source) {
      return subscription;
    }

    return {
      ...subscription,
      payments: [
        {
          ...source,
          id: `pay-${Date.now()}`,
          date: addOneMonthToDate(source.date),
          status: 'Pending',
        },
        ...subscription.payments,
      ],
    };
  });

  saveState();
  showToast('Payment duplicated');
  render();
}

function addOneMonthToDate(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
  if (!match) {
    return new Date().toISOString().slice(0, 10);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);

  const nextMonthIndex = monthIndex + 1;
  const targetYear = year + Math.floor(nextMonthIndex / 12);
  const targetMonthIndex = nextMonthIndex % 12;
  const maxDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, maxDay);

  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

function deletePayment(subscriptionId, paymentId) {
  state.subscriptions = state.subscriptions.map((subscription) => {
    if (subscription.id !== subscriptionId || subscription.payments.length <= 1) {
      return subscription;
    }

    return {
      ...subscription,
      payments: subscription.payments.filter((payment) => payment.id !== paymentId),
    };
  });

  saveState();
  showToast('Payment removed');
  render();
}

function deleteSubscription(subscriptionId) {
  state.subscriptions = state.subscriptions.filter((subscription) => subscription.id !== subscriptionId);
  saveState();
  showToast('Subscription removed');
  render();
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(message);
  } catch (error) {
    console.warn('Clipboard API unavailable.', error);
    showToast('Copy unavailable in this browser');
  }
}

function showToast(message) {
  ui.toast = message;
  render();

  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    ui.toast = '';
    render();
  }, 1800);
}

function createId(value) {
  return `${value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now()}`;
}

function pickColor(index) {
  const avatarColors = [
    '#4f6df5',
    '#9c5ee8',
    '#20b686',
    '#f39a2d',
    '#de5f7f',
    '#1aa8c5',
    '#6b82d8',
    '#d26bd8',
    '#55b95f',
    '#e06f35',
    '#3b7bdc',
    '#aa7a2c',
  ];

  return avatarColors[index % avatarColors.length];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

function icon(name) {
  const icons = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
    bookmark: '<path d="M6 4h12v16l-6-4-6 4z"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10"/><path d="M15 9.5A3 3 0 0 0 12 8c-1.7 0-3 1-3 2.4 0 3.1 6 1.6 6 5 0 1.4-1.3 2.6-3 2.6a3.4 3.4 0 0 1-3.2-1.8"/>',
    trend: '<path d="M4 16l5-5 4 4 7-8"/><path d="M15 7h5v5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 10.6A3 3 0 0 0 13.4 13.4"/><path d="M7.5 7.8C4.3 9.5 2.5 12 2.5 12s3.5 6 9.5 6a9.8 9.8 0 0 0 4.2-.9"/><path d="M20.1 15.4A13 13 0 0 0 21.5 12s-3.5-6-9.5-6a9.7 9.7 0 0 0-2.5.3"/>',
    edit: '<path d="M12 20h9"/><path d="m16.5 3.5 4 4L7 21H3v-4z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    building: '<path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16"/><path d="M9 21v-5h3v5"/><path d="M8 7h1M12 7h1M8 11h1M12 11h1M17 9h2a1 1 0 0 1 1 1v11"/>',
    beaker: '<path d="M9 3h6"/><path d="M10 3v5l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V3"/><path d="M8 14h8"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
    sort: '<path d="M8 7h8M8 12h5M8 17h2"/>',
    sortDesc: '<path d="M8 7h2M8 12h5M8 17h8"/>',
    vault: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 9v6M9 12h6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chart: '<path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="5" rx="1"/><rect x="12" y="7" width="3" height="9" rx="1"/><rect x="17" y="9" width="3" height="7" rx="1"/>',
    card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
    invoice: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v5h5"/><path d="M10 12h6M10 16h6"/>',
    report: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5M12 16V8M16 16v-7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7.8 7.8 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 3.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 3.1h5l.3-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z"/>',
    menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
    filter: '<path d="M4 5h16l-6.5 7.4V18l-3 1.5v-7.1z"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  };

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        ${icons[name] || icons.vault}
      </g>
    </svg>
  `;
}

render();
