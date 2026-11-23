import { useEffect, useMemo, useState } from 'react';
import { Activity, Building2, Plus, Scale, Share2, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AnalyticsSummary, Department, Role, User } from '../../shared/types.ts';
import { formatCampusDateTime } from '../../shared/timezone.ts';
import { api, type EnrichedAuditLog } from '../lib/api.ts';
import { KpiCard } from './ui/KpiCard.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { DashboardSkeleton } from './ui/Skeleton.tsx';
import { SurfaceCard, SurfaceCardHeader } from './ui/SurfaceCard.tsx';

interface AdminDashboardProps {
  currentUser: User;
  departments: Department[];
  onRefreshGlobal: () => Promise<void>;
}

const KNOWN_CERTIFICATIONS = [
  'LAB_SAFETY_101',
  'FAB_3D_PRINTING',
  'CNC_SAFETY_L1',
  'HV_OSCILLOSCOPE',
  'ESD_PROTECTION',
  'GPU_CLUSTER_AUTH',
];

export function AdminDashboard({
  currentUser,
  departments,
  onRefreshGlobal,
}: AdminDashboardProps) {
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [auditLogs, setAuditLogs] = useState<EnrichedAuditLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditFilter, setAuditFilter] = useState('');

  // Add department form
  const [deptCode, setDeptCode] = useState('');
  const [deptName, setDeptName] = useState('');
  const [deptBuilding, setDeptBuilding] = useState('');
  const [deptEmail, setDeptEmail] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  async function loadAdminData() {
    setLoading(true);
    try {
      const [anRes, audRes, usrRes] = await Promise.all([
        api.getAnalytics(),
        api.getAuditLogs(),
        currentUser.role === 'ADMIN' ? api.getUsers() : Promise.resolve({ users: [] }),
      ]);
      setAnalytics(anRes.analytics);
      setAuditLogs(audRes.auditLogs);
      setUsers(usrRes.users);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdminData();
  }, [currentUser.id]);

  const filteredLogs = useMemo(() => {
    if (!auditFilter) return auditLogs;
    return auditLogs.filter((l) => l.action === auditFilter);
  }, [auditLogs, auditFilter]);

  async function handleToggleCert(user: User, cert: string) {
    const next = user.certifications.includes(cert)
      ? user.certifications.filter((c) => c !== cert)
      : [...user.certifications, cert];
    try {
      await api.updateUser(user.id, { certifications: next });
      await loadAdminData();
      setFeedback({ type: 'success', message: `Updated certifications for ${user.name}.` });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to update certifications',
      });
    }
  }

  async function handleRoleChange(userId: string, role: Role) {
    try {
      await api.updateUser(userId, { role });
      await loadAdminData();
      setFeedback({ type: 'success', message: `Updated user role to ${role}.` });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to update role',
      });
    }
  }

  async function handleAddDepartment(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createDepartment({
        code: deptCode.trim().toUpperCase(),
        name: deptName.trim(),
        building: deptBuilding.trim(),
        contactEmail: deptEmail.trim(),
      });
      setDeptCode('');
      setDeptName('');
      setDeptBuilding('');
      setDeptEmail('');
      await Promise.all([loadAdminData(), onRefreshGlobal()]);
      setFeedback({ type: 'success', message: 'Department created.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to create department',
      });
    }
  }

  if (loading && !analytics) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        variant="hero"
        kicker="Campus Governance Console · Asia/Kolkata"
        title="Campus Analytics, Fairness Governance & Audit Console"
        description="Real-time utilization telemetry, cross-department resource sharing ratios, Jain fairness index, and immutable faculty override records."
        contextLine={
          <>
            <span className="font-mono font-semibold text-white">{currentUser.role}</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#38BDF8] font-semibold">
              {departments.length} active campus departments
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-[#CBD5E1]">
              {auditLogs.length} immutable audit records
            </span>
          </>
        }
      />

      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`p-3.5 rounded-xl text-xs border ${
            feedback.type === 'success'
              ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Elevated Analytics KPI Strip */}
      {analytics && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Cross-Dept Sharing"
              value={`${analytics.crossDepartmentSharePercent}%`}
              subtext={`${analytics.crossDepartmentBookingsCount} of ${analytics.totalReservations} bookings`}
              icon={Share2}
              tone="teal"
            />
            <KpiCard
              label="Average Utilization"
              value={`${analytics.averageUtilizationPercent}%`}
              subtext={`${analytics.availableEquipment}/${analytics.totalEquipment} assets available`}
              icon={Activity}
              tone="blue"
            />
            <KpiCard
              label="Jain Fairness Index"
              value={analytics.fairnessIndex.toFixed(1)}
              subtext="Equity across 30d student hours"
              icon={Scale}
              tone="navy"
            />
            <KpiCard
              label="SmartFair Override Rate"
              value={`${analytics.overrideRatePercent}%`}
              subtext={`${analytics.overrideCount} overrides · ${analytics.conflictReviewRequests} open conflicts`}
              icon={ShieldAlert}
              tone="amber"
            />
          </div>

          {/* Department Utilization & Student Equity */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <SurfaceCard className="lg:col-span-7 overflow-hidden">
              <SurfaceCardHeader
                title="Department Utilization & Cross-Department Inbound"
                subtitle="Live utilization & booked hours across campus laboratories"
              />
              {/* Visual Department Utilization Comparison Bars */}
              <div className="px-5 py-4 bg-[#F3F6FA]/75 border-b border-[#DCE4EE] grid grid-cols-2 sm:grid-cols-4 gap-3">
                {analytics.departmentUtilization.map((d) => (
                  <div key={d.departmentId} className="space-y-1.5">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-mono font-bold text-[#0F172A]">
                        {d.departmentCode}
                      </span>
                      <span className="font-mono font-semibold text-[#2563EB] tabular-nums">
                        {d.utilizationPercent}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-[#DCE4EE] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#2563EB] transition-[width] duration-300"
                        style={{ width: `${Math.min(100, d.utilizationPercent)}%` }}
                      />
                    </div>
                    <div className="font-mono text-[10px] text-[#64748B] tabular-nums">
                      {d.bookedHours}h · {d.crossDepartmentInboundCount} inbound
                    </div>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F3F6FA] border-b border-[#DCE4EE] text-[#475569]">
                    <tr>
                      <th className="py-3.5 px-4 font-semibold">Department</th>
                      <th className="py-3.5 px-4 font-semibold text-right">Assets</th>
                      <th className="py-3.5 px-4 font-semibold text-right">Booked Hrs</th>
                      <th className="py-3.5 px-4 font-semibold text-right">Inbound</th>
                      <th className="py-3.5 px-4 font-semibold text-right">Utilization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {analytics.departmentUtilization.map((d) => (
                      <tr key={d.departmentId} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="py-3.5 px-4">
                          <span className="font-mono font-bold text-[#0F172A]">
                            {d.departmentCode}
                          </span>{' '}
                          <span className="text-[#475569]">{d.departmentName}</span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                          {d.equipmentCount}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                          {d.bookedHours}h
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                          {d.crossDepartmentInboundCount}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="inline-flex items-center gap-2.5 justify-end">
                            <div className="w-20 h-2 bg-[#E2E8F0] rounded-full overflow-hidden hidden sm:block">
                              <div
                                className="h-full bg-[#2563EB]"
                                style={{ width: `${Math.min(100, d.utilizationPercent)}%` }}
                              />
                            </div>
                            <span className="font-mono font-bold text-[#1D4ED8] tabular-nums">
                              {d.utilizationPercent}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SurfaceCard>

            <SurfaceCard className="lg:col-span-5 p-5 sm:p-6 space-y-4">
              <div className="flex items-baseline justify-between border-b border-[#E2E8F0] pb-3">
                <h3 className="font-display text-sm sm:text-base font-bold text-[#0F172A]">
                  Student 30-Day Rolling Access Distribution
                </h3>
                <span className="font-mono text-[11px] font-semibold text-[#64748B]">
                  40h Fairness Cap
                </span>
              </div>
              <div className="space-y-4">
                {analytics.studentUsageDistribution.map((s) => {
                  const pct = Math.min(100, Math.round((s.rolling30DayHoursUsed / 40) * 100));
                  return (
                    <div key={s.studentId} className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold text-[#0F172A]">{s.studentName}</span>
                        <span className="font-mono text-[#475569] tabular-nums">
                          {s.rolling30DayHoursUsed}h / 40h · {s.approvedCount} approved
                        </span>
                      </div>
                      <div className="h-2.5 bg-[#E2E8F0] rounded-full overflow-hidden">
                        <div className="h-full bg-[#0D9488]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </SurfaceCard>
          </div>
        </>
      )}

      {/* Immutable Audit Log Viewer */}
      <SurfaceCard className="overflow-hidden">
        <SurfaceCardHeader
          headingId="audit-log-heading"
          title="Immutable Governance & Override Audit Log"
          subtitle="Chronological append-only record of approvals, rejections, SmartFair overrides, maintenance blocks, and check-ins."
          dark
          action={
            <select
              aria-label="Filter audit logs by action"
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium text-white bg-[#1E293B] border border-[#334155] rounded-lg"
            >
              <option value="">All Audit Actions</option>
              <option value="OVERRIDE_RECOMMENDATION">OVERRIDE_RECOMMENDATION</option>
              <option value="APPROVE">APPROVE</option>
              <option value="REJECT">REJECT</option>
              <option value="AUTO_RELEASE_NO_SHOW">AUTO_RELEASE_NO_SHOW</option>
              <option value="MARK_NO_SHOW">MARK_NO_SHOW</option>
              <option value="CREATE_EQUIPMENT">CREATE_EQUIPMENT</option>
              <option value="MAINTENANCE_BLOCK">MAINTENANCE_BLOCK</option>
              <option value="CHECK_OUT">CHECK_OUT</option>
              <option value="RETURN">RETURN</option>
              <option value="SUBMIT_REQUEST">SUBMIT_REQUEST</option>
              <option value="RESCHEDULE_REQUEST">RESCHEDULE_REQUEST</option>
            </select>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F3F6FA] border-b border-[#DCE4EE] text-[#475569]">
              <tr>
                <th className="py-3.5 px-4 font-semibold">Timestamp (IST)</th>
                <th className="py-3.5 px-4 font-semibold">Actor</th>
                <th className="py-3.5 px-4 font-semibold">Action</th>
                <th className="py-3.5 px-4 font-semibold">Target</th>
                <th className="py-3.5 px-4 font-semibold">Governance Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="py-3 px-4 font-mono text-[#475569] tabular-nums whitespace-nowrap">
                    {formatCampusDateTime(log.timestamp)}
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-semibold text-[#0F172A]">{log.actorName}</span>{' '}
                    <span className="text-[#64748B]">({log.actorRole})</span>
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-[#0F172A] whitespace-nowrap">
                    <span
                      className={
                        log.action === 'OVERRIDE_RECOMMENDATION'
                          ? 'text-[#B45309]'
                          : log.action === 'REJECT'
                            ? 'text-[#DC2626]'
                            : 'text-[#2563EB]'
                      }
                    >
                      {log.action}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-[#475569]">{log.targetEntityId}</td>
                  <td className="py-3 px-4 text-[#334155] max-w-md">
                    {log.metadata.overrideReasonCode ? (
                      <div>
                        <span className="font-mono font-bold text-[#B45309]">
                          {String(log.metadata.overrideReasonCode)}
                        </span>
                        : {String(log.metadata.overrideJustification || '')}
                      </div>
                    ) : log.metadata.reason ? (
                      <span>{String(log.metadata.reason)}</span>
                    ) : (
                      <span className="font-mono text-[#64748B]">
                        {JSON.stringify(log.metadata)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      {/* Admin-Only Users & Departments Controls */}
      {currentUser.role === 'ADMIN' && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <SurfaceCard className="lg:col-span-8 p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#2563EB]" aria-hidden="true" />
              <h3 className="font-display text-base font-bold text-[#0F172A]">
                User Roles &amp; Safety Certification Clearances
              </h3>
            </div>
            <div className="divide-y divide-[#E2E8F0]">
              {users.map((u) => (
                <div key={u.id} className="py-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="text-sm font-semibold text-[#0F172A]">{u.name}</span>{' '}
                      <span className="text-xs font-mono text-[#64748B]">{u.email}</span>
                    </div>
                    <select
                      aria-label={`Role for ${u.name}`}
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value as Role)}
                      className="px-2.5 py-1.5 text-xs font-semibold bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
                    >
                      <option value="STUDENT">STUDENT</option>
                      <option value="FACULTY">FACULTY</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {KNOWN_CERTIFICATIONS.map((cert) => {
                      const has = u.certifications.includes(cert);
                      return (
                        <button
                          key={cert}
                          type="button"
                          onClick={() => handleToggleCert(u, cert)}
                          className={`px-2.5 py-1 text-[11px] font-mono rounded-lg border transition-colors ${
                            has
                              ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46] font-semibold'
                              : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]'
                          }`}
                        >
                          {has ? '✓ ' : '+ '}
                          {cert}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </SurfaceCard>

          <form
            onSubmit={handleAddDepartment}
            className="lg:col-span-4 surface-card rounded-2xl p-5 sm:p-6 space-y-3 h-fit"
          >
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#0F172A]" aria-hidden="true" />
              <h3 className="font-display text-base font-bold text-[#0F172A]">
                Departments ({departments.length})
              </h3>
            </div>
            <div className="space-y-1.5 text-xs text-[#475569] pb-3 border-b border-[#E2E8F0]">
              {departments.map((d) => (
                <div key={d.id}>
                  <span className="font-mono font-bold text-[#0F172A]">{d.code}</span> ·{' '}
                  {d.name}
                </div>
              ))}
            </div>
            <div className="text-xs font-semibold text-[#0F172A] pt-1">
              Register New Department
            </div>
            <input
              type="text"
              required
              placeholder="Code (e.g., BIOE)"
              value={deptCode}
              onChange={(e) => setDeptCode(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
            />
            <input
              type="text"
              required
              placeholder="Department Name"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
            />
            <input
              type="text"
              required
              placeholder="Building / Wing"
              value={deptBuilding}
              onChange={(e) => setDeptBuilding(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
            />
            <input
              type="email"
              required
              placeholder="labs-contact@campus.edu"
              value={deptEmail}
              onChange={(e) => setDeptEmail(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
            />
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-white bg-[#0B132B] rounded-xl hover:bg-[#1E293B]"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Department</span>
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
