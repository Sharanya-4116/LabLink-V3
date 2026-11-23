import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react';
import type {
  Department,
  Equipment,
  MaintenanceWindow,
  PublicOverview,
  User,
} from '../shared/types.ts';
import { formatCampusDateTime, formatCampusSlotRange } from '../shared/timezone.ts';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { EquipmentCatalog } from './components/EquipmentCatalog.tsx';
import { FacultyDashboard } from './components/FacultyDashboard.tsx';
import { LabLinkLogo } from './components/LabLinkLogo.tsx';
import { LandingPage } from './components/LandingPage.tsx';
import { StudentDashboard } from './components/StudentDashboard.tsx';
import {
  api,
  setAuthHeadersContext,
  type EnrichedAuditLog,
  type EnrichedBookingRequest,
  type EnrichedReservation,
  type SessionInfo,
} from './lib/api.ts';
import { signOutCampusAuth } from './lib/firebaseClient.ts';

type WorkspaceTab = 'overview' | 'catalog' | 'faculty' | 'governance';

interface NotificationItem {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  kind: 'conflict' | 'decision' | 'maintenance' | 'override' | 'session';
  targetTab: WorkspaceTab;
}

export default function App() {
  const [overview, setOverview] = useState<PublicOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [session, setSession] = useState<SessionInfo | null>(null);

  const [view, setView] = useState<'landing' | 'workspace'>('landing');
  const [bootResolved, setBootResolved] = useState(false);
  const didAutoEnterRef = useRef(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [preselectedEquipmentId, setPreselectedEquipmentId] = useState<string | null>(null);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
  const [catalogCertifiedOnly, setCatalogCertifiedOnly] = useState(false);
  const [catalogDepartmentId, setCatalogDepartmentId] = useState('');

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Global search & popovers
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [notifPopoverOpen, setNotifPopoverOpen] = useState(false);
  const [profilePopoverOpen, setProfilePopoverOpen] = useState(false);
  const [seenNotifIds, setSeenNotifIds] = useState<Set<string>>(new Set());

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const notifContainerRef = useRef<HTMLDivElement>(null);
  const profileContainerRef = useRef<HTMLDivElement>(null);

  // Workspace API state
  const [departments, setDepartments] = useState<Department[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [maintenanceWindows, setMaintenanceWindows] = useState<MaintenanceWindow[]>([]);
  const [bookings, setBookings] = useState<EnrichedBookingRequest[]>([]);
  const [reservations, setReservations] = useState<EnrichedReservation[]>([]);
  const [auditLogs, setAuditLogs] = useState<EnrichedAuditLog[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [hasLoadedWorkspaceOnce, setHasLoadedWorkspaceOnce] = useState(false);

  const loadWorkspaceData = useCallback(async (role?: User['role']) => {
    setWorkspaceLoading(true);
    try {
      const [deptRes, eqRes, mntRes, bookRes, resRes, audRes] = await Promise.all([
        api.getDepartments(),
        api.getEquipment(),
        api.getMaintenanceWindows(),
        api.getBookings(),
        api.getReservations(),
        role === 'FACULTY' || role === 'ADMIN'
          ? api.getAuditLogs()
          : Promise.resolve({ auditLogs: [] as EnrichedAuditLog[] }),
      ]);
      setDepartments(deptRes.departments);
      setEquipment(eqRes.equipment);
      setMaintenanceWindows(mntRes.maintenanceWindows);
      setBookings(bookRes.bookings);
      setReservations(resRes.reservations);
      setAuditLogs(audRes.auditLogs);
      setHasLoadedWorkspaceOnce(true);
    } finally {
      setWorkspaceLoading(false);
    }
  }, []);

  const loadPublicAndSession = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const [ov, sess] = await Promise.all([api.getPublicOverview(), api.getSession()]);
      setOverview(ov);
      setSession(sess);

      // In Competition Demo Mode on initial boot, launch directly into the Student Command Center
      // so the redesigned workspace dashboard is immediately visible (Production Mode stays on sign-in).
      if (
        !didAutoEnterRef.current &&
        sess.appMode === 'demo' &&
        sess.allowDemoRoleSwitch &&
        !sess.user
      ) {
        didAutoEnterRef.current = true;
        const defaultDemoId =
          sess.demoUsers.find((u) => u.id === 'usr-stu-aarav')?.id ?? sess.demoUsers[0]?.id;
        if (defaultDemoId) {
          setAuthHeadersContext({ demoUserId: defaultDemoId, bearerToken: null });
          const authedSess = await api.getSession();
          setSession(authedSess);
          if (authedSess.user) {
            setView('workspace');
            setActiveTab(defaultTabForRole(authedSess.user));
            await loadWorkspaceData(authedSess.user.role);
          }
        }
      }
    } finally {
      setOverviewLoading(false);
      setBootResolved(true);
    }
  }, [loadWorkspaceData]);

  useEffect(() => {
    loadPublicAndSession();
  }, [loadPublicAndSession]);

  function defaultTabForRole(user: User): WorkspaceTab {
    if (user.role === 'FACULTY') return 'faculty';
    if (user.role === 'ADMIN') return 'governance';
    return 'overview';
  }

  async function handleEnterWorkspace(demoUserId?: string, equipId?: string) {
    if (demoUserId) {
      setAuthHeadersContext({ demoUserId, bearerToken: null });
    }
    const sess = await api.getSession();
    setSession(sess);

    if (sess.user) {
      setHasLoadedWorkspaceOnce(false);
      setView('workspace');
      setCatalogSearchQuery('');
      setCatalogCertifiedOnly(false);
      setCatalogDepartmentId('');
      if (equipId) {
        setPreselectedEquipmentId(equipId);
        setActiveTab('catalog');
      } else {
        setPreselectedEquipmentId(null);
        setActiveTab(defaultTabForRole(sess.user));
      }
      await loadWorkspaceData(sess.user.role);
    }
  }

  async function handleDemoUserSwitch(newUserId: string) {
    setAuthHeadersContext({ demoUserId: newUserId, bearerToken: null });
    setProfilePopoverOpen(false);
    setNotifPopoverOpen(false);
    setSearchPopoverOpen(false);
    const sess = await api.getSession();
    setSession(sess);
    if (sess.user) {
      setPreselectedEquipmentId(null);
      setCatalogSearchQuery('');
      setCatalogCertifiedOnly(false);
      setCatalogDepartmentId('');
      setActiveTab(defaultTabForRole(sess.user));
      await loadWorkspaceData(sess.user.role);
    }
  }

  async function handleProductionSignIn(idToken: string) {
    setAuthHeadersContext({ bearerToken: idToken, demoUserId: null });
    const sess = await api.getSession();
    setSession(sess);
    if (sess.user) {
      setHasLoadedWorkspaceOnce(false);
      setView('workspace');
      setActiveTab(defaultTabForRole(sess.user));
      await loadWorkspaceData(sess.user.role);
    }
  }

  async function handleSignOut() {
    if (session?.appMode === 'production') {
      await signOutCampusAuth();
    }
    setAuthHeadersContext({ bearerToken: null, demoUserId: null });
    setProfilePopoverOpen(false);
    setNotifPopoverOpen(false);
    setSearchPopoverOpen(false);
    setView('landing');
    await loadPublicAndSession();
  }

  // Close popovers on outside click or Escape
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as Node;
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setSearchPopoverOpen(false);
      }
      if (notifContainerRef.current && !notifContainerRef.current.contains(target)) {
        setNotifPopoverOpen(false);
      }
      if (profileContainerRef.current && !profileContainerRef.current.contains(target)) {
        setProfilePopoverOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSearchPopoverOpen(false);
        setNotifPopoverOpen(false);
        setProfilePopoverOpen(false);
        setMobileNavOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const currentUser = session?.user ?? null;

  // Real notification items computed from live bookings, reservations, maintenance, and audit logs
  const notifications = useMemo<NotificationItem[]>(() => {
    if (!currentUser) return [];
    const items: NotificationItem[] = [];
    const equipById = new Map(equipment.map((e) => [e.id, e]));

    for (const b of bookings) {
      if (b.status === 'CONFLICT_REVIEW') {
        items.push({
          id: `notif-conflict-${b.id}`,
          title:
            currentUser.role === 'STUDENT'
              ? `Conflict alert: ${b.equipmentName}`
              : `Conflict review queued: ${b.projectTitle}`,
          detail:
            currentUser.role === 'STUDENT'
              ? `${b.projectTitle} · Alternative SmartFair slots available`
              : `${b.studentName} · ${b.equipmentName} (${formatCampusSlotRange(
                  b.requestedStart,
                  b.requestedEnd
                )})`,
          timestamp: b.lastSubmittedAt,
          kind: 'conflict',
          targetTab: currentUser.role === 'STUDENT' ? 'overview' : 'faculty',
        });
      } else if (
        currentUser.role === 'STUDENT' &&
        (b.status === 'APPROVED' || b.status === 'REJECTED') &&
        b.facultyDecisionReason
      ) {
        items.push({
          id: `notif-decision-${b.id}-${b.status}`,
          title: `Request ${b.status.toLowerCase()}: ${b.projectTitle}`,
          detail: b.facultyDecisionReason,
          timestamp: b.lastSubmittedAt,
          kind: 'decision',
          targetTab: 'overview',
        });
      }
    }

    for (const r of reservations) {
      if (r.lifecycleStatus === 'CHECKED_OUT') {
        items.push({
          id: `notif-checkout-${r.id}`,
          title: `Equipment checked out: ${r.equipmentName}`,
          detail: `${r.studentName} · ${r.labRoom} (${formatCampusSlotRange(
            r.startTime,
            r.endTime
          )})`,
          timestamp: r.checkedOutAt ?? r.startTime,
          kind: 'session',
          targetTab: currentUser.role === 'STUDENT' ? 'overview' : 'faculty',
        });
      }
    }

    for (const m of maintenanceWindows.slice(0, 3)) {
      const eq = equipById.get(m.equipmentId);
      items.push({
        id: `notif-maint-${m.id}`,
        title: `Maintenance window: ${eq?.name ?? m.equipmentId}`,
        detail: `${m.reason} · ${formatCampusSlotRange(m.startTime, m.endTime)}`,
        timestamp: m.startTime,
        kind: 'maintenance',
        targetTab: currentUser.role === 'STUDENT' ? 'catalog' : 'faculty',
      });
    }

    if (currentUser.role === 'ADMIN' || currentUser.role === 'FACULTY') {
      for (const log of auditLogs.filter((l) => l.action === 'OVERRIDE_RECOMMENDATION').slice(0, 3)) {
        items.push({
          id: `notif-override-${log.id}`,
          title: `SmartFair Override by ${log.actorName}`,
          detail: `${String(log.metadata.overrideReasonCode ?? 'OVERRIDE')} · Target ${
            log.targetEntityId
          }`,
          timestamp: log.timestamp,
          kind: 'override',
          targetTab: 'governance',
        });
      }
    }

    return items.slice(0, 8);
  }, [currentUser, bookings, reservations, maintenanceWindows, equipment, auditLogs]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !seenNotifIds.has(n.id)).length,
    [notifications, seenNotifIds]
  );

  // Global search results wired directly to loaded equipment & bookings
  const globalSearchMatches = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return { eqMatches: [] as Equipment[], bookingMatches: [] as EnrichedBookingRequest[] };
    const eqMatches = equipment
      .filter((eq) =>
        [eq.name, eq.assetTag, eq.category, eq.labRoom, ...eq.capabilities]
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 4);
    const bookingMatches = bookings
      .filter((b) =>
        [b.projectTitle, b.equipmentName, b.studentName, b.id].join(' ').toLowerCase().includes(q)
      )
      .slice(0, 3);
    return { eqMatches, bookingMatches };
  }, [globalSearch, equipment, bookings]);

  if (!bootResolved) {
    return (
      <div className="min-h-screen bg-[#0B132B] text-white flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4">
          <LabLinkLogo size="lg" tone="light" />
          <div className="text-xs font-mono text-[#94A3B8]">
            Initializing campus scheduling workspace...
          </div>
        </div>
      </div>
    );
  }

  if (view === 'landing' || !currentUser) {
    return (
      <LandingPage
        overview={overview}
        overviewLoading={overviewLoading}
        session={session}
        onEnterWorkspace={handleEnterWorkspace}
        onProductionSignIn={handleProductionSignIn}
      />
    );
  }

  const isDemo = Boolean(session?.appMode === 'demo' && session?.allowDemoRoleSwitch);
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const userDept = deptById.get(currentUser.departmentId);

  const navItems: Array<{
    id: WorkspaceTab;
    section: 'Operations' | 'Discovery' | 'Governance';
    label: string;
    icon: typeof LayoutDashboard;
    badgeCount?: number;
    visible: boolean;
  }> = [
    {
      id: 'overview',
      section: 'Operations',
      label: 'Command Center',
      icon: LayoutDashboard,
      badgeCount: bookings.filter((b) => b.status === 'CONFLICT_REVIEW').length,
      visible: currentUser.role === 'STUDENT',
    },
    {
      id: 'faculty',
      section: 'Operations',
      label: 'Conflict & Lab Desk',
      icon: ClipboardCheck,
      badgeCount: bookings.filter(
        (b) => b.status === 'PENDING' || b.status === 'CONFLICT_REVIEW'
      ).length,
      visible: currentUser.role === 'FACULTY' || currentUser.role === 'ADMIN',
    },
    {
      id: 'catalog',
      section: 'Discovery',
      label: 'Equipment Catalog',
      icon: BookOpen,
      visible: true,
    },
    {
      id: 'governance',
      section: 'Governance',
      label: 'Analytics & Audit Log',
      icon: BarChart3,
      visible: currentUser.role === 'FACULTY' || currentUser.role === 'ADMIN',
    },
  ];

  const visibleNavItems = navItems.filter((n) => n.visible);
  const navSections = Array.from(new Set(visibleNavItems.map((n) => n.section)));
  const activeNavLabel = visibleNavItems.find((n) => n.id === activeTab)?.label ?? 'Workspace';

  function navigateToCatalog(opts?: {
    equipId?: string;
    searchQuery?: string;
    certifiedOnly?: boolean;
    departmentId?: string;
  }) {
    setPreselectedEquipmentId(opts?.equipId ?? null);
    setCatalogSearchQuery(opts?.searchQuery ?? '');
    setCatalogCertifiedOnly(Boolean(opts?.certifiedOnly));
    setCatalogDepartmentId(opts?.departmentId ?? '');
    setActiveTab('catalog');
    setSearchPopoverOpen(false);
  }

  function handleGlobalSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!globalSearch.trim()) return;
    navigateToCatalog({ searchQuery: globalSearch.trim() });
  }

  const userInitials = currentUser.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  const canvasVariantClass =
    activeTab === 'catalog'
      ? 'bg-lablink-canvas--catalog'
      : activeTab === 'governance'
        ? 'bg-lablink-canvas--admin'
        : activeTab === 'faculty'
          ? 'bg-lablink-canvas--faculty'
          : '';

  return (
    <div className="min-h-screen flex flex-col bg-[#EEF2F7] text-[#0F172A]">
      <a
        href="#workspace-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-[#0B132B] focus:text-white focus:rounded-md"
      >
        Skip to workspace content
      </a>

      {/* Explicit Competition Demo Mode Banner */}
      {isDemo && session && (
        <div className="bg-[#0B132B] text-white border-b border-[#1E293B] px-4 sm:px-6 py-2">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <span className="font-mono font-bold uppercase tracking-wider text-[#38BDF8]">
                Competition Demo Mode
              </span>
              <span className="text-[#94A3B8] hidden sm:inline">
                · Seeded SQLite ACID transactions · Switch accounts to evaluate Student, Faculty &amp;
                Admin workflows
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <label htmlFor="demo-user-select" className="text-[#CBD5E1] font-medium whitespace-nowrap">
                Active Persona:
              </label>
              <select
                id="demo-user-select"
                value={currentUser.id}
                onChange={(e) => handleDemoUserSwitch(e.target.value)}
                className="bg-[#1E293B] text-white border border-[#334155] rounded-lg px-3 py-1 text-xs font-semibold hover:border-[#475569] transition-colors"
              >
                {session.demoUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.role} — {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex w-full">
        {/* Deep Midnight Navy Collapsible Desktop Sidebar */}
        <aside
          aria-label="Workspace sidebar"
          className={`hidden lg:flex shrink-0 bg-gradient-to-b from-[#0B132B] via-[#0D1734] to-[#091024] text-white border-r border-[#1E293B] flex-col justify-between transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-[76px] px-3 py-5' : 'w-[264px] p-5'
          }`}
        >
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-white/10">
              <button
                type="button"
                onClick={() => setView('landing')}
                className="text-left focus-visible:outline-white min-w-0"
                aria-label="Return to LabLink landing page"
              >
                <LabLinkLogo size="md" tone="light" showWordmark={!sidebarCollapsed} />
                {!sidebarCollapsed && (
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#64748B] mt-1.5 pl-10.5 truncate">
                    Campus Lab Network
                  </div>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSidebarCollapsed((c) => !c)}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!sidebarCollapsed}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="p-1.5 text-[#94A3B8] hover:text-white rounded-lg hover:bg-white/10 transition-colors shrink-0"
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>

            <nav aria-label="Workspace navigation" className="space-y-5">
              {navSections.map((section) => {
                const itemsInSection = visibleNavItems.filter((n) => n.section === section);
                return (
                  <div key={section} className="space-y-1.5">
                    {!sidebarCollapsed && (
                      <div className="px-3 text-[11px] font-mono font-semibold uppercase tracking-wider text-[#64748B]">
                        {section}
                      </div>
                    )}
                    {itemsInSection.map((item) => {
                      const Icon = item.icon;
                      const active = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-current={active ? 'page' : undefined}
                          title={sidebarCollapsed ? item.label : undefined}
                          onClick={() => {
                            setPreselectedEquipmentId(null);
                            setCatalogSearchQuery('');
                            setCatalogCertifiedOnly(false);
                            setCatalogDepartmentId('');
                            setActiveTab(item.id);
                          }}
                          className={`w-full flex items-center ${
                            sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3.5'
                          } py-2.5 text-sm rounded-xl transition-colors text-left whitespace-nowrap ${
                            active
                              ? 'bg-[#2563EB] text-white font-semibold shadow-sm'
                              : 'text-[#CBD5E1] hover:bg-white/8 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-3 min-w-0">
                            <Icon
                              className={`w-4 h-4 shrink-0 ${
                                active ? 'text-white' : 'text-[#94A3B8]'
                              }`}
                              aria-hidden="true"
                            />
                            {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                          </span>
                          {!sidebarCollapsed && typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                            <span
                              className={`font-mono text-[11px] font-semibold tabular-nums ${
                                active ? 'text-white/90' : 'text-[#38BDF8]'
                              }`}
                            >
                              {item.badgeCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
          </div>

            <div className="pt-4 border-t border-white/10 space-y-3">
              {!sidebarCollapsed && isDemo && session && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
                  <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#94A3B8]">
                    Role View Switcher
                  </div>
                  <div className="grid grid-cols-3 gap-1 bg-[#070D1F] p-1 rounded-lg border border-white/10">
                    {(
                      [
                        { role: 'STUDENT', userId: 'usr-stu-aarav', label: 'Student' },
                        { role: 'FACULTY', userId: 'usr-fac-ananya', label: 'Faculty' },
                        { role: 'ADMIN', userId: 'usr-adm-meera', label: 'Admin' },
                      ] as const
                    ).map((btn) => {
                      const activeRole = currentUser.role === btn.role;
                      const target = session.demoUsers.find((u) => u.id === btn.userId);
                      if (!target) return null;
                      return (
                        <button
                          key={btn.role}
                          type="button"
                          onClick={() => handleDemoUserSwitch(target.id)}
                          className={`px-1.5 py-1.5 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap ${
                            activeRole
                              ? 'bg-[#2563EB] text-white'
                              : 'text-[#94A3B8] hover:text-white'
                          }`}
                        >
                          {btn.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {!sidebarCollapsed && (
                <div className="text-xs bg-white/5 border border-white/10 rounded-xl p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white truncate">{currentUser.name}</span>
                    <span className="font-mono text-[10px] font-semibold text-[#38BDF8] shrink-0">
                      {currentUser.role}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-[#94A3B8] truncate mt-0.5">
                    {userDept?.code ?? currentUser.departmentId} · {currentUser.email}
                  </div>
                </div>
              )}
            <div className={`flex items-center gap-2 ${sidebarCollapsed ? 'flex-col' : ''}`}>
              <button
                type="button"
                onClick={() => setView('landing')}
                title="Landing Home"
                className="flex-1 w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-[#CBD5E1] bg-white/5 border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition-colors"
              >
                <Home className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {!sidebarCollapsed && <span>Home</span>}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                title="Exit Workspace"
                className="flex-1 w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-[#CBD5E1] bg-white/5 border border-white/10 rounded-lg hover:text-[#FCA5A5] hover:border-[#F87171]/40 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {!sidebarCollapsed && <span>Exit</span>}
              </button>
            </div>
          </div>
        </aside>

        {/* Main Workspace Viewport with Layered Ambient Canvas */}
        <div
          className={`flex-1 flex flex-col min-w-0 bg-lablink-canvas ${canvasVariantClass}`}
        >
          {/* Top Navigation Bar */}
          <header className="bg-white/88 backdrop-blur-md border-b border-[#DCE4EE] px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sticky top-0 z-30">
            {/* Zone 1: View Title & Breadcrumb */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                aria-label="Open navigation menu"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden p-2 text-[#475569] hover:text-[#0F172A] rounded-lg hover:bg-[#F1F5F9]"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <div className="text-xs text-[#64748B] truncate flex items-center gap-1.5">
                  <span className="hidden sm:inline">LabLink</span>
                  <span className="hidden sm:inline text-[#CBD5E1]">/</span>
                  <span className="font-display text-sm font-bold text-[#0F172A] truncate">
                    {activeNavLabel}
                  </span>
                </div>
                <div className="hidden xl:block font-mono text-[11px] text-[#64748B]">
                  Schedule TZ: {session?.campusTimezone ?? 'Asia/Kolkata'}
                </div>
              </div>
            </div>

            {/* Zone 2: Global Search Input Wired to Live Equipment & Bookings */}
            <div ref={searchContainerRef} className="relative flex-1 max-w-md hidden md:block">
              <form onSubmit={handleGlobalSearchSubmit}>
                <Search
                  className="w-4 h-4 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  aria-label="Search campus equipment, asset tags, or project requests"
                  value={globalSearch}
                  onFocus={() => setSearchPopoverOpen(true)}
                  onChange={(e) => {
                    setGlobalSearch(e.target.value);
                    setSearchPopoverOpen(true);
                  }}
                  placeholder="Search equipment, asset tag, or project..."
                  className="w-full pl-10 pr-3.5 py-2 text-xs sm:text-sm bg-[#F3F6FA] border border-[#DCE4EE] rounded-xl focus:bg-white focus:border-[#2563EB] transition-colors"
                />
              </form>

              {searchPopoverOpen && globalSearch.trim().length > 0 && (
                <div
                  role="region"
                  aria-label="Search results"
                  className="absolute left-0 right-0 mt-2 bg-white border border-[#E2E8F0] rounded-2xl shadow-xl overflow-hidden z-40"
                >
                  {globalSearchMatches.eqMatches.length === 0 &&
                  globalSearchMatches.bookingMatches.length === 0 ? (
                    <div className="p-4 text-xs text-[#64748B]">
                      No matching equipment or requests for &ldquo;{globalSearch}&rdquo;. Press Enter
                      to search full catalog.
                    </div>
                  ) : (
                    <div className="divide-y divide-[#E2E8F0]">
                      {globalSearchMatches.eqMatches.map((eq) => (
                        <button
                          key={eq.id}
                          type="button"
                          onClick={() => {
                            setGlobalSearch('');
                            navigateToCatalog({ equipId: eq.id });
                          }}
                          className="w-full px-4 py-2.5 text-left hover:bg-[#F8FAFC] flex items-center justify-between gap-3 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#0F172A] truncate">
                              {eq.name}
                            </div>
                            <div className="font-mono text-[11px] text-[#64748B] truncate">
                              {eq.assetTag} · {eq.labRoom}
                            </div>
                          </div>
                          <span className="text-[11px] font-semibold text-[#2563EB] shrink-0">
                            Inspect
                          </span>
                        </button>
                      ))}
                      {globalSearchMatches.bookingMatches.map((bk) => (
                        <button
                          key={bk.id}
                          type="button"
                          onClick={() => {
                            setGlobalSearch('');
                            setSearchPopoverOpen(false);
                            setActiveTab(currentUser.role === 'STUDENT' ? 'overview' : 'faculty');
                          }}
                          className="w-full px-4 py-2.5 text-left hover:bg-[#F8FAFC] flex items-center justify-between gap-3 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#0F172A] truncate">
                              {bk.projectTitle}
                            </div>
                            <div className="text-[11px] text-[#64748B] truncate">
                              {bk.equipmentName} · {bk.status}
                            </div>
                          </div>
                          <span className="text-[11px] font-mono text-[#475569] shrink-0">
                            Request
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => navigateToCatalog({ searchQuery: globalSearch.trim() })}
                        className="w-full px-4 py-2.5 text-xs font-semibold text-[#2563EB] bg-[#F8FAFC] hover:bg-[#EFF6FF] flex items-center justify-between transition-colors"
                      >
                        <span>Filter Equipment Catalog for &ldquo;{globalSearch.trim()}&rdquo;</span>
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Zone 3: Primary Action, Sync, Notifications & User Profile */}
            <div className="flex items-center gap-2.5 shrink-0">
              {currentUser.role === 'STUDENT' && activeTab !== 'catalog' && (
                <button
                  type="button"
                  onClick={() => navigateToCatalog()}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors whitespace-nowrap shrink-0"
                >
                  <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>New Request</span>
                </button>
              )}

              {(currentUser.role === 'FACULTY' || currentUser.role === 'ADMIN') &&
                activeTab !== 'faculty' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('faculty')}
                    className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors whitespace-nowrap shrink-0"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Conflict Desk</span>
                  </button>
                )}

              <button
                type="button"
                onClick={() => loadWorkspaceData(currentUser.role)}
                aria-label="Sync workspace data"
                title="Refresh live data"
                className="p-2 text-[#475569] bg-white border border-[#E2E8F0] rounded-xl hover:text-[#0F172A] hover:border-[#CBD5E1] transition-colors"
              >
                <RefreshCw
                  className={`w-4 h-4 ${workspaceLoading ? 'animate-spin text-[#2563EB]' : ''}`}
                  aria-hidden="true"
                />
              </button>

              {/* Real Notification Center Trigger & Popover */}
              <div ref={notifContainerRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setNotifPopoverOpen((o) => !o);
                    setProfilePopoverOpen(false);
                  }}
                  aria-label={`Notifications (${unreadCount} unread)`}
                  aria-expanded={notifPopoverOpen}
                  className="relative inline-flex items-center gap-1.5 p-2 text-[#475569] bg-white border border-[#E2E8F0] rounded-xl hover:text-[#0F172A] hover:border-[#CBD5E1] transition-colors"
                >
                  <Bell className="w-4 h-4" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <span className="font-mono text-[11px] font-bold text-[#2563EB] tabular-nums pr-0.5">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {notifPopoverOpen && (
                  <div
                    role="dialog"
                    aria-label="Workspace notifications"
                    className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-[#E2E8F0] rounded-2xl shadow-xl overflow-hidden z-40"
                  >
                    <div className="px-4 py-3 bg-[#0B132B] text-white flex items-center justify-between">
                      <div>
                        <div className="font-display text-xs font-bold">
                          Live Workspace Notifications
                        </div>
                        <div className="text-[11px] text-[#94A3B8]">
                          Synced from active requests, sessions &amp; maintenance
                        </div>
                      </div>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setSeenNotifIds(new Set(notifications.map((n) => n.id)))}
                          className="text-[11px] font-semibold text-[#38BDF8] hover:underline"
                        >
                          Mark read
                        </button>
                      )}
                    </div>

                    {notifications.length === 0 ? (
                      <div className="p-5 text-xs text-[#64748B] text-center">
                        All clear. No pending conflicts, overrides, or active alerts.
                      </div>
                    ) : (
                      <div className="max-h-80 overflow-y-auto divide-y divide-[#E2E8F0]">
                        {notifications.map((item) => {
                          const isUnread = !seenNotifIds.has(item.id);
                          const Icon =
                            item.kind === 'conflict'
                              ? AlertTriangle
                              : item.kind === 'maintenance'
                                ? Wrench
                                : item.kind === 'override'
                                  ? ShieldAlert
                                  : CheckCircle2;
                          const iconColor =
                            item.kind === 'conflict'
                              ? 'text-[#B45309]'
                              : item.kind === 'override'
                                ? 'text-[#DC2626]'
                                : item.kind === 'maintenance'
                                  ? 'text-[#0D9488]'
                                  : 'text-[#2563EB]';
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setSeenNotifIds((prev) => new Set(prev).add(item.id));
                                setNotifPopoverOpen(false);
                                setActiveTab(item.targetTab);
                              }}
                              className={`w-full px-4 py-3 text-left hover:bg-[#F8FAFC] flex items-start gap-3 transition-colors ${
                                isUnread ? 'bg-[#EFF6FF]/40' : 'bg-white'
                              }`}
                            >
                              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true" />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold text-[#0F172A] truncate">
                                  {item.title}
                                </div>
                                <div className="text-[11px] text-[#475569] mt-0.5 line-clamp-2">
                                  {item.detail}
                                </div>
                                <div className="font-mono text-[10px] text-[#64748B] mt-1 tabular-nums">
                                  {formatCampusDateTime(item.timestamp)} IST
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* User Profile / Role Indicator */}
              <div ref={profileContainerRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setProfilePopoverOpen((o) => !o);
                    setNotifPopoverOpen(false);
                  }}
                  aria-expanded={profilePopoverOpen}
                  aria-label="Account profile and role details"
                  className="inline-flex items-center gap-2.5 pl-2 pr-2.5 py-1.5 bg-white border border-[#E2E8F0] rounded-xl hover:border-[#CBD5E1] transition-colors"
                >
                  <span className="w-7 h-7 rounded-lg bg-[#0B132B] text-white font-display text-xs font-bold flex items-center justify-center shrink-0">
                    {userInitials}
                  </span>
                  <span className="hidden sm:block text-left leading-tight">
                    <span className="block text-xs font-semibold text-[#0F172A] max-w-[120px] truncate">
                      {currentUser.name}
                    </span>
                    <span className="block font-mono text-[10px] text-[#64748B]">
                      {currentUser.role} · {userDept?.code ?? currentUser.departmentId}
                    </span>
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-[#64748B] shrink-0" aria-hidden="true" />
                </button>

                {profilePopoverOpen && (
                  <div
                    role="dialog"
                    aria-label="User session menu"
                    className="absolute right-0 mt-2 w-72 bg-white border border-[#E2E8F0] rounded-2xl shadow-xl p-4 space-y-3 z-40"
                  >
                    <div className="border-b border-[#E2E8F0] pb-3">
                      <div className="text-sm font-bold text-[#0F172A]">{currentUser.name}</div>
                      <div className="font-mono text-xs text-[#64748B] truncate">
                        {currentUser.email}
                      </div>
                      <div className="text-xs text-[#475569] mt-1">
                        {userDept?.name ?? currentUser.departmentId} ·{' '}
                        <span className="font-mono font-semibold text-[#2563EB]">
                          {currentUser.role}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-[#475569] space-y-1">
                      <div className="font-semibold text-[#0F172A]">Active Clearances</div>
                      <div className="font-mono text-[11px] text-[#059669]">
                        {currentUser.certifications.join(', ') || 'None'}
                      </div>
                    </div>

                    {isDemo && session ? (
                      <div className="pt-2 border-t border-[#E2E8F0] space-y-1.5">
                        <div className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#64748B]">
                          Switch Demo Account
                        </div>
                        <div className="space-y-1">
                          {session.demoUsers.map((u) => (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => handleDemoUserSwitch(u.id)}
                              className={`w-full px-2.5 py-1.5 text-left text-xs rounded-lg flex items-center justify-between ${
                                u.id === currentUser.id
                                  ? 'bg-[#EFF6FF] text-[#1D4ED8] font-semibold'
                                  : 'hover:bg-[#F8FAFC] text-[#334155]'
                              }`}
                            >
                              <span className="truncate">{u.name}</span>
                              <span className="font-mono text-[10px] shrink-0">{u.role}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="pt-2 border-t border-[#E2E8F0] flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setProfilePopoverOpen(false);
                          setView('landing');
                        }}
                        className="flex-1 px-3 py-2 text-xs font-medium text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg hover:text-[#0F172A]"
                      >
                        Landing Home
                      </button>
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="flex-1 px-3 py-2 text-xs font-semibold text-[#DC2626] bg-[#FEF2F2] border border-[#FECACA] rounded-lg hover:bg-[#FEE2E2]"
                      >
                        {isDemo ? 'Exit Demo' : 'Sign Out'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Main Workspace Content */}
          <main
            id="workspace-main"
            className="relative z-10 flex-1 p-5 sm:p-6 lg:p-8 max-w-[1360px] w-full mx-auto"
          >
            {activeTab === 'overview' && currentUser.role === 'STUDENT' && (
              <StudentDashboard
                currentUser={currentUser}
                departments={departments}
                equipment={equipment}
                maintenanceWindows={maintenanceWindows}
                bookings={bookings}
                reservations={reservations}
                loading={workspaceLoading && !hasLoadedWorkspaceOnce}
                onRefresh={async () => {
                  await Promise.all([loadWorkspaceData(currentUser.role), loadPublicAndSession()]);
                }}
                onNavigateCatalog={(opts) => navigateToCatalog(opts)}
              />
            )}

            {activeTab === 'catalog' && (
              <EquipmentCatalog
                currentUser={currentUser}
                departments={departments}
                initialSelectedEquipmentId={preselectedEquipmentId}
                initialSearchQuery={catalogSearchQuery}
                initialCertifiedOnly={catalogCertifiedOnly}
                initialDepartmentId={catalogDepartmentId}
                onBookingCreated={async () => {
                  await Promise.all([loadWorkspaceData(currentUser.role), loadPublicAndSession()]);
                }}
              />
            )}

            {activeTab === 'faculty' &&
              (currentUser.role === 'FACULTY' || currentUser.role === 'ADMIN') && (
                <FacultyDashboard
                  currentUser={currentUser}
                  departments={departments}
                  noShowGraceMinutes={session?.noShowGraceMinutes ?? 20}
                  bookings={bookings}
                  reservations={reservations}
                  loading={workspaceLoading && !hasLoadedWorkspaceOnce}
                  onRefresh={async () => {
                    await Promise.all([loadWorkspaceData(currentUser.role), loadPublicAndSession()]);
                  }}
                />
              )}

            {activeTab === 'governance' &&
              (currentUser.role === 'FACULTY' || currentUser.role === 'ADMIN') && (
                <AdminDashboard
                  currentUser={currentUser}
                  departments={departments}
                  onRefreshGlobal={() => loadWorkspaceData(currentUser.role)}
                />
              )}
          </main>
        </div>
      </div>

      {/* Responsive Midnight Navy Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0B132B]/55 backdrop-blur-[2px] lg:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
        >
          <div className="w-76 bg-[#0B132B] text-white h-full p-5 flex flex-col justify-between shadow-2xl">
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <LabLinkLogo size="md" tone="light" />
                <button
                  type="button"
                  aria-label="Close navigation menu"
                  onClick={() => setMobileNavOpen(false)}
                  className="p-1.5 text-[#94A3B8] hover:text-white rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="space-y-1.5">
                {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileNavOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm rounded-xl text-left ${
                        active
                          ? 'bg-[#2563EB] text-white font-semibold'
                          : 'text-[#CBD5E1] hover:bg-white/8'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className="w-4 h-4" aria-hidden="true" />
                        <span>{item.label}</span>
                      </span>
                      {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                        <span className="font-mono text-xs text-[#38BDF8]">{item.badgeCount}</span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                handleSignOut();
              }}
              className="w-full px-3 py-2.5 text-xs font-semibold text-[#FCA5A5] border border-[#F87171]/30 rounded-xl hover:bg-white/5"
            >
              Exit to Landing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
