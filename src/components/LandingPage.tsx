import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Cpu,
  GraduationCap,
  Layers,
  Lock,
  Scale,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import type { PublicOverview, Role, User } from '../../shared/types.ts';
import type { SessionInfo } from '../lib/api.ts';
import { isFirebaseClientConfigured, signInWithCampusEmail } from '../lib/firebaseClient.ts';
import { EquipmentImage } from './EquipmentImage.tsx';
import { LabLinkLogo } from './LabLinkLogo.tsx';
import { StatusText } from './StatusText.tsx';

interface LandingPageProps {
  overview: PublicOverview | null;
  overviewLoading: boolean;
  session: SessionInfo | null;
  onEnterWorkspace: (demoUserId?: string, equipId?: string) => void;
  onProductionSignIn: (idToken: string) => Promise<void>;
}

const HERO_IMAGE = '/src/assets/images/hero_campus_lab_1795420978171.jpg';

const ROLE_CARDS: Array<{
  role: Role;
  title: string;
  summary: string;
  defaultUserId: string;
  cta: string;
  icon: typeof GraduationCap;
}> = [
  {
    role: 'STUDENT',
    title: 'Student Researcher',
    summary:
      'Discover cross-department equipment, verify certification eligibility, submit project-based bookings, and reschedule via SmartFair alternatives.',
    defaultUserId: 'usr-stu-aarav',
    cta: 'Enter Student Workspace',
    icon: GraduationCap,
  },
  {
    role: 'FACULTY',
    title: 'Faculty Lab Supervisor',
    summary:
      'Inspect overlapping conflict clusters, review SmartFair 5-factor scores, approve or override with mandatory audit justification, and manage maintenance.',
    defaultUserId: 'usr-fac-ananya',
    cta: 'Enter Faculty Workspace',
    icon: UserCheck,
  },
  {
    role: 'ADMIN',
    title: 'Campus Administrator',
    summary:
      'Monitor cross-department sharing ratios, Jain fairness index, equipment utilization analytics, user certifications, and immutable override audit logs.',
    defaultUserId: 'usr-adm-meera',
    cta: 'Enter Admin Console',
    icon: ShieldCheck,
  },
];

export function LandingPage({
  overview,
  overviewLoading,
  session,
  onEnterWorkspace,
  onProductionSignIn,
}: LandingPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const isDemoMode = session?.appMode === 'demo' && session?.allowDemoRoleSwitch;
  const deptMap = new Map((overview?.departments || []).map((d) => [d.id, d]));

  async function handleProdLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setSigningIn(true);
    try {
      const token = await signInWithCampusEmail(email.trim(), password);
      await onProductionSignIn(token);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSigningIn(false);
    }
  }

  function handlePrimaryAccess() {
    if (session?.user) {
      onEnterWorkspace(session.user.id);
    } else if (isDemoMode) {
      onEnterWorkspace('usr-stu-aarav');
    } else {
      document.getElementById('access')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-lablink-canvas text-[#0F172A]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-[#0F172A] focus:text-white focus:rounded-md"
      >
        Skip to main content
      </a>

      {/* Top Bar Contract: strictly 3 zones separated by gap-8 */}
      <header className="bg-white/88 backdrop-blur-md border-b border-[#DCE4EE] sticky top-0 z-30">
        <div className="max-w-[1240px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a href="#top" className="whitespace-nowrap shrink-0">
            <LabLinkLogo size="md" />
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-8 text-sm font-medium text-[#475569]"
          >
            <a
              href="#capabilities"
              className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </a>
            <a
              href="#smartfair"
              className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0"
            >
              SmartFair
            </a>
            <a
              href="#equipment"
              className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0"
            >
              Equipment
            </a>
            <a
              href="#access"
              className="hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0"
            >
              Access
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handlePrimaryAccess}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#1D4ED8] rounded-lg shadow-sm hover:bg-[#1E40AF] active:scale-[0.99] transition-all whitespace-nowrap shrink-0"
            >
              <span>Open Workspace</span>
              <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="relative z-10 flex-1">
        {/* Hero Split */}
        <section id="top" className="bg-academic-grid border-b border-[#DCE4EE]">
          <div className="max-w-[1240px] mx-auto px-6 pt-12 pb-14 lg:pt-16 lg:pb-18">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
              <div className="lg:col-span-6 flex flex-col justify-center">
                <div className="text-xs font-mono font-semibold uppercase tracking-[0.12em] text-[#0F766E] mb-3.5">
                  Campus Laboratory Resource-Sharing · Asia/Kolkata Scheduling
                </div>
                <h1
                  className="font-display font-bold tracking-tight text-[#0F172A] leading-[1.06] mb-5"
                  style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', textWrap: 'balance' }}
                >
                  Making specialized college laboratories accessible and fairly scheduled.
                </h1>
                <p className="text-base sm:text-[17px] text-[#475569] leading-relaxed max-w-[54ch] mb-8">
                  LabLink connects students across engineering, computing, and robotics departments
                  to shared instruments, fabrication systems, and GPU workstations—resolving
                  scheduling conflicts through explainable SmartFair scoring and atomic slot-lock
                  reservations.
                </p>

                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={handlePrimaryAccess}
                    className="inline-flex items-center gap-2.5 px-6 py-3.5 text-sm font-semibold text-white bg-[#0F172A] rounded-xl shadow-[0_8px_20px_rgba(15,23,42,0.16)] hover:bg-[#1E293B] active:scale-[0.99] transition-all whitespace-nowrap"
                  >
                    <span>Explore Equipment &amp; Book</span>
                    <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                  </button>
                  <a
                    href="#smartfair"
                    className="inline-flex items-center gap-1.5 px-4 py-3 text-sm font-semibold text-[#1D4ED8] bg-white border border-[#CBD5E1] rounded-xl hover:border-[#93C5FD] hover:bg-[#EFF6FF] transition-colors whitespace-nowrap"
                  >
                    <span>Inspect SmartFair Rules</span>
                    <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  </a>
                </div>
              </div>

              {/* Architectural Dark Bezel Frame */}
              <div className="lg:col-span-6">
                <div className="bg-[#0F172A] p-2.5 rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.18)] border border-[#1E293B]">
                  <div className="relative aspect-[16/11] rounded-xl overflow-hidden bg-[#1E293B]">
                    <EquipmentImage
                      src={HERO_IMAGE}
                      alt="University engineering laboratory with 3D printers, oscilloscopes, and student researchers collaborating"
                      title="Campus Engineering Laboratory"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0F172A] via-[#0F172A]/65 to-transparent p-5">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-[#38BDF8]">
                        MECH · ECE · CSAI · ROBO Shared Infrastructure
                      </div>
                      <div className="text-sm font-medium text-white mt-1">
                        Real-time 60-minute slot-bucket locking &amp; safety clearance verification
                      </div>
                    </div>
                  </div>
                  <div className="px-3 pt-2.5 pb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#94A3B8]">
                    <span>ACID TRANSACTION ENGINE · IST (UTC+05:30)</span>
                    <span className="text-[#34D399]">4 DEPARTMENTS CONNECTED</span>
                  </div>
                </div>
              </div>
            </div>

            {/* High-Contrast Dark Navy KPI Command Strip */}
            <div
              className="mt-12 surface-navy-featured text-white rounded-2xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-white/10"
              aria-label="Live campus laboratory statistics"
            >
              <div className="p-6">
                <div className="text-xs font-medium text-[#94A3B8]">Shared Lab Equipment</div>
                <div className="font-mono text-2xl sm:text-3xl font-bold text-white tabular-nums mt-1.5">
                  {overviewLoading
                    ? '—'
                    : `${overview?.availableEquipment ?? 0} / ${overview?.totalEquipment ?? 0}`}
                </div>
                <div className="text-xs text-[#CBD5E1] mt-1">
                  Across {overview?.totalDepartments ?? 4} campus departments
                </div>
              </div>
              <div className="p-6">
                <div className="text-xs font-medium text-[#94A3B8]">Cross-Department Share</div>
                <div className="font-mono text-2xl sm:text-3xl font-bold text-[#34D399] tabular-nums mt-1.5">
                  {overviewLoading ? '—' : `${overview?.crossDepartmentSharePercent ?? 0}%`}
                </div>
                <div className="text-xs text-[#CBD5E1] mt-1">
                  Bookings outside home department
                </div>
              </div>
              <div className="p-6">
                <div className="text-xs font-medium text-[#94A3B8]">Confirmed &amp; Completed</div>
                <div className="font-mono text-2xl sm:text-3xl font-bold text-[#38BDF8] tabular-nums mt-1.5">
                  {overviewLoading ? '—' : overview?.totalBookingsCompletedOrActive ?? 0}
                </div>
                <div className="text-xs text-[#CBD5E1] mt-1">
                  Atomic slot-locked reservations
                </div>
              </div>
              <div className="p-6">
                <div className="text-xs font-medium text-[#94A3B8]">Active Conflict Queue</div>
                <div className="font-mono text-2xl sm:text-3xl font-bold text-[#FBBF24] tabular-nums mt-1.5">
                  {overviewLoading ? '—' : overview?.pendingConflictsCount ?? 0}
                </div>
                <div className="text-xs text-[#CBD5E1] mt-1">
                  Avg utilization {overview?.averageUtilizationPercent ?? 0}%
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities Bento */}
        <section id="capabilities" className="max-w-[1240px] mx-auto px-6 py-16">
          <div className="max-w-2xl mb-10">
            <p className="text-xs font-mono font-semibold uppercase tracking-wider text-[#1D4ED8] mb-2">
              Platform Architecture
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
              Structured around academic safety, concurrency, and equity
            </h2>
            <p className="text-sm sm:text-base text-[#475569] mt-2.5 leading-relaxed">
              Every workflow prevents double-booking collisions, enforces mandatory safety
              certifications, and records faculty accountability in an immutable audit trail.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-7 surface-card rounded-2xl p-6 sm:p-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8] flex items-center justify-center">
                    <Cpu className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#64748B]">01</span>
                </div>
                <h3 className="font-display text-lg font-bold text-[#0F172A]">
                  Cross-Department Equipment Discovery
                </h3>
                <p className="text-sm text-[#475569] mt-2 leading-relaxed">
                  Students search 3D printers, oscilloscopes, FPGA boards, CNC mills, robotics arms,
                  and GPU clusters across departments with instant safety certification matching and
                  live maintenance visibility.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-[#E2E8F0] flex flex-wrap gap-x-5 gap-y-1.5 text-xs font-mono text-[#475569]">
                <span>MECH · Rapid Fab</span>
                <span>ECE · Signals &amp; VLSI</span>
                <span>CSAI · CUDA Compute</span>
                <span>ROBO · Autonomous Systems</span>
              </div>
            </div>

            <div className="md:col-span-5 surface-card rounded-2xl p-6 sm:p-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669] flex items-center justify-center">
                    <Layers className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#64748B]">02</span>
                </div>
                <h3 className="font-display text-lg font-bold text-[#0F172A]">
                  Deterministic Slot-Bucket Locks
                </h3>
                <p className="text-sm text-[#475569] mt-2 leading-relaxed">
                  Every operating day in Asia/Kolkata is partitioned into 60-minute lock buckets
                  committed inside atomic transactions—eliminating race-condition double bookings
                  while allowing back-to-back handoffs.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-[#E2E8F0] font-mono text-xs font-medium text-[#0F766E]">
                A_start &lt; B_end ∧ B_start &lt; A_end → 409 Conflict
              </div>
            </div>

            <div className="md:col-span-5 surface-card rounded-2xl p-6 sm:p-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-[#0F172A] text-white flex items-center justify-center">
                    <Scale className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#64748B]">03</span>
                </div>
                <h3 className="font-display text-lg font-bold text-[#0F172A]">
                  Anti-Gaming Fair Queuing
                </h3>
                <p className="text-sm text-[#475569] mt-2 leading-relaxed">
                  Waiting time priority is anchored strictly to the immutable original request
                  timestamp. Rescheduling to an alternative slot never resets or inflates queue
                  priority.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-[#E2E8F0] font-mono text-xs text-[#475569]">
                Immutable Anchor: originalCreatedAt (72h cap)
              </div>
            </div>

            <div className="md:col-span-7 surface-card rounded-2xl p-6 sm:p-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[#B45309] flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#64748B]">04</span>
                </div>
                <h3 className="font-display text-lg font-bold text-[#0F172A]">
                  Explainable Faculty Override Governance
                </h3>
                <p className="text-sm text-[#475569] mt-2 leading-relaxed">
                  Faculty review side-by-side SmartFair scores before approval. Choosing a contender
                  other than the top recommendation requires a structured reason code and detailed
                  justification logged permanently in the audit log.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-[#E2E8F0] text-xs font-mono text-[#64748B]">
                Audit Events: APPROVE · REJECT · OVERRIDE_RECOMMENDATION · MAINTENANCE_BLOCK
              </div>
            </div>
          </div>
        </section>

        {/* How SmartFair Works */}
        <section id="smartfair" className="bg-[#F3F6FA]/85 border-y border-[#DCE4EE] py-16">
          <div className="max-w-[1240px] mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
              <div className="lg:col-span-5 space-y-6">
                <div>
                  <p className="text-xs font-mono font-semibold uppercase tracking-wider text-[#0F766E] mb-2">
                    Deterministic Allocation Engine
                  </p>
                  <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
                    How SmartFair ranks competing requests
                  </h2>
                  <p className="text-sm sm:text-base text-[#475569] mt-3 leading-relaxed">
                    Hard safety and scheduling constraints (H1–H4) always override weighted scores.
                    Requests failing a hard constraint are automatically routed to up to 3 valid
                    alternative slots within the next 7 campus operating days.
                  </p>
                </div>

                {/* High-contrast Dark Slate H1-H4 Gate Matrix */}
                <div className="surface-navy-featured text-white rounded-2xl p-6 space-y-4">
                  <div className="relative z-10 flex items-center justify-between border-b border-white/10 pb-3">
                    <span className="font-display text-sm font-semibold">
                      Mandatory Hard Constraint Gates
                    </span>
                    <span className="font-mono text-[11px] text-[#34D399]">NON-OVERRIDABLE</span>
                  </div>
                  <div className="space-y-3 text-xs sm:text-sm">
                    <div className="flex items-start gap-3">
                      <span className="font-mono text-xs font-bold text-[#38BDF8] w-7 shrink-0 pt-0.5">
                        H1
                      </span>
                      <span className="text-[#E2E8F0]">Equipment must be in AVAILABLE status</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="font-mono text-xs font-bold text-[#38BDF8] w-7 shrink-0 pt-0.5">
                        H2
                      </span>
                      <span className="text-[#E2E8F0]">
                        Interval within Asia/Kolkata operating hours &amp; max booking duration
                      </span>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="font-mono text-xs font-bold text-[#38BDF8] w-7 shrink-0 pt-0.5">
                        H3
                      </span>
                      <span className="text-[#E2E8F0]">
                        Zero interval overlap with confirmed reservations or maintenance
                      </span>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="font-mono text-xs font-bold text-[#38BDF8] w-7 shrink-0 pt-0.5">
                        H4
                      </span>
                      <span className="text-[#E2E8F0]">
                        Student holds all required laboratory safety certifications
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 surface-card rounded-2xl p-6 sm:p-8 space-y-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#E2E8F0] pb-4">
                  <div>
                    <h3 className="font-display text-lg font-bold text-[#0F172A]">
                      Weighted Ranking Formula
                    </h3>
                    <p className="text-xs text-[#64748B] mt-0.5">
                      Evaluated deterministically across eligible cluster contenders
                    </p>
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#1D4ED8] tabular-nums">
                    0 – 100 Composite Scale
                  </span>
                </div>

                {/* Proportional Visual Weight Bar */}
                <div className="space-y-1.5">
                  <div className="h-3 w-full rounded-full overflow-hidden flex bg-[#E2E8F0]">
                    <div className="bg-[#1D4ED8] h-full" style={{ width: '35%' }} title="35% Urgency" />
                    <div className="bg-[#2563EB] h-full border-l border-white/40" style={{ width: '25%' }} title="25% Capability" />
                    <div className="bg-[#0F766E] h-full border-l border-white/40" style={{ width: '20%' }} title="20% Wait Time" />
                    <div className="bg-[#10B981] h-full border-l border-white/40" style={{ width: '10%' }} title="10% Fairness" />
                    <div className="bg-[#0F172A] h-full border-l border-white/40" style={{ width: '10%' }} title="10% Efficiency" />
                  </div>
                  <div className="flex justify-between font-mono text-[11px] text-[#64748B] tabular-nums">
                    <span>35% U</span>
                    <span>25% C</span>
                    <span>20% W</span>
                    <span>10% F</span>
                    <span>10% E</span>
                  </div>
                </div>

                <div className="space-y-4 pt-1">
                  {[
                    {
                      label: 'Deadline Urgency (U)',
                      weight: '35%',
                      desc: 'Proximity of project deadline to requested start across a 30-day horizon.',
                      width: '35%',
                      color: 'bg-[#1D4ED8]',
                    },
                    {
                      label: 'Capability Compatibility (C)',
                      weight: '25%',
                      desc: 'Matches requested capabilities while penalizing over-provisioning specialized assets.',
                      width: '25%',
                      color: 'bg-[#2563EB]',
                    },
                    {
                      label: 'Anti-Gaming Wait Time (W)',
                      weight: '20%',
                      desc: 'Elapsed hours since immutable originalCreatedAt (capped at 72h).',
                      width: '20%',
                      color: 'bg-[#0F766E]',
                    },
                    {
                      label: 'Previous Access Fairness (F)',
                      weight: '10%',
                      desc: 'Prioritizes students with lower rolling 30-day laboratory usage (40h cap).',
                      width: '10%',
                      color: 'bg-[#10B981]',
                    },
                    {
                      label: 'Resource Utilization Efficiency (E)',
                      weight: '10%',
                      desc: 'Rewards flush scheduling within 30 minutes of open/close or adjacent bookings.',
                      width: '10%',
                      color: 'bg-[#0F172A]',
                    },
                  ].map((row) => (
                    <div key={row.label} className="space-y-1.5">
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-semibold text-[#0F172A]">{row.label}</span>
                        <span className="font-mono font-bold text-[#1D4ED8] tabular-nums">
                          {row.weight}
                        </span>
                      </div>
                      <div className="h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
                        <div className={`h-full ${row.color}`} style={{ width: row.width }} />
                      </div>
                      <p className="text-xs text-[#475569]">{row.desc}</p>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-[#64748B] pt-4 border-t border-[#E2E8F0]">
                  Deterministic Tie-Breaker: Higher Score → Earlier Project Deadline → Earlier
                  Original Created Timestamp → Lexicographical Request ID.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Featured Laboratory Resources */}
        <section id="equipment" className="max-w-[1240px] mx-auto px-6 py-16">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-9">
            <div>
              <p className="text-xs font-mono font-semibold uppercase tracking-wider text-[#1D4ED8] mb-1.5">
                Campus Inventory
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
                Featured campus laboratory equipment
              </h2>
              <p className="text-sm text-[#475569] mt-1.5">
                Live availability and specifications pulled directly from campus inventory.
              </p>
            </div>
            <button
              type="button"
              onClick={handlePrimaryAccess}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1D4ED8] hover:text-[#1E40AF] hover:underline underline-offset-4 whitespace-nowrap"
            >
              <span>Browse Full Catalog</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {(overview?.featuredEquipment || []).map((eq) => {
              const dept = deptMap.get(eq.departmentId);
              const firstSpec = Object.entries(eq.specs)[0];
              return (
                <article
                  key={eq.id}
                  className="group surface-card-interactive rounded-2xl overflow-hidden flex flex-col"
                >
                  <div className="relative aspect-[4/3] bg-[#0F172A] border-b border-[#E2E8F0] overflow-hidden">
                    <EquipmentImage
                      src={eq.imageUrl}
                      alt={eq.name}
                      title={eq.name}
                      className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0F172A]/85 via-[#0F172A]/35 to-transparent px-3.5 py-2.5 flex items-center justify-between text-[11px] font-mono text-white">
                      <span>{dept?.code ?? eq.departmentId}</span>
                      <span className="text-[#CBD5E1]">{eq.assetTag}</span>
                    </div>
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <StatusText status={eq.status} />
                      <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                        Max {eq.maxBookingHours}h
                      </span>
                    </div>
                    <h3 className="font-display text-[15px] font-bold text-[#0F172A] leading-snug">
                      {eq.name}
                    </h3>
                    <p className="text-xs text-[#475569] mt-1.5 truncate">{eq.labRoom}</p>
                    {firstSpec && (
                      <p className="text-xs font-mono text-[#64748B] mt-1.5 pt-2 border-t border-[#F1F5F9] truncate">
                        {firstSpec[0]}: {firstSpec[1]}
                      </p>
                    )}
                    <div className="mt-auto pt-4">
                      <button
                        type="button"
                        onClick={() =>
                          onEnterWorkspace(isDemoMode ? 'usr-stu-aarav' : undefined, eq.id)
                        }
                        className="w-full px-3.5 py-2.5 text-xs font-semibold text-[#0F172A] bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl hover:bg-[#1D4ED8] hover:border-[#1D4ED8] hover:text-white transition-colors"
                      >
                        Inspect &amp; Request Slot
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Access & Role Entry */}
        <section id="access" className="bg-[#F3F6FA]/85 border-t border-[#DCE4EE] py-16">
          <div className="max-w-[1240px] mx-auto px-6">
            {isDemoMode ? (
              <div>
                <div className="max-w-2xl mb-9">
                  <div className="text-xs font-mono font-semibold uppercase tracking-wider text-[#0F766E] mb-2">
                    Competition Demo Mode Active
                  </div>
                  <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
                    Select a campus role to evaluate live workflows
                  </h2>
                  <p className="text-sm text-[#475569] mt-2 leading-relaxed">
                    Demo mode is seeded with active multi-student conflict clusters, certification
                    checks, maintenance windows, and audit logs backed by SQLite ACID transactions.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {ROLE_CARDS.map((card) => {
                    const demoUser: User | undefined = session?.demoUsers.find(
                      (u) => u.id === card.defaultUserId
                    );
                    const Icon = card.icon;
                    return (
                      <div
                        key={card.role}
                        className="surface-card-interactive rounded-2xl p-6 flex flex-col justify-between bg-white"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-3 mb-5">
                            <div className="w-11 h-11 rounded-xl bg-[#0F172A] text-white flex items-center justify-center shadow-sm">
                              <Icon className="w-5 h-5" aria-hidden="true" />
                            </div>
                            <span className="text-xs font-mono font-semibold text-[#64748B]">
                              {card.role}
                            </span>
                          </div>
                          <h3 className="font-display text-lg font-bold text-[#0F172A]">
                            {card.title}
                          </h3>
                          {demoUser && (
                            <p className="text-xs font-semibold text-[#1D4ED8] mt-1">
                              {demoUser.name} · {demoUser.certifications.length} clearances
                            </p>
                          )}
                          <p className="text-sm text-[#475569] mt-3 leading-relaxed">
                            {card.summary}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onEnterWorkspace(card.defaultUserId)}
                          className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F172A] rounded-xl hover:bg-[#1D4ED8] transition-colors whitespace-nowrap"
                        >
                          <span>{card.cta}</span>
                          <ArrowRight className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="max-w-md mx-auto surface-card rounded-2xl p-7">
                <div className="flex items-center gap-2 text-xs font-mono font-semibold text-[#1D4ED8] mb-2">
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  <span>Production Campus Authentication</span>
                </div>
                <h2 className="font-display text-xl font-bold text-[#0F172A]">
                  Sign in with your campus account
                </h2>
                <p className="text-xs text-[#475569] mt-1">
                  Roles and permissions are verified server-side via Firebase Authentication.
                </p>

                {!isFirebaseClientConfigured() ? (
                  <p className="text-xs text-[#B45309] mt-4 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-3">
                    Production mode is active, but VITE_FIREBASE_* client environment variables are
                    not configured in this build.
                  </p>
                ) : (
                  <form onSubmit={handleProdLogin} className="mt-5 space-y-4">
                    <div>
                      <label htmlFor="prod-email" className="block text-xs font-medium text-[#334155] mb-1">
                        Campus Email
                      </label>
                      <input
                        id="prod-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@campus.edu"
                        className="w-full px-3 py-2 text-sm bg-white border border-[#CBD5E1] rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="prod-password" className="block text-xs font-medium text-[#334155] mb-1">
                        Password
                      </label>
                      <input
                        id="prod-password"
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-[#CBD5E1] rounded-lg"
                      />
                    </div>
                    {authError && (
                      <p role="alert" className="text-xs text-[#DC2626]">
                        {authError}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={signingIn}
                      className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] rounded-lg hover:bg-[#1E40AF] disabled:opacity-50"
                    >
                      {signingIn ? 'Signing in...' : 'Sign In'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="bg-[#0F172A] text-[#94A3B8] border-t border-[#1E293B] py-8">
        <div className="max-w-[1240px] mx-auto px-6 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <LabLinkLogo size="sm" tone="light" />
            <span className="text-[#CBD5E1]">
              · Campus Laboratory Resource-Sharing &amp; Fair Scheduling
            </span>
          </div>
          <span className="font-mono text-[#94A3B8]">Schedule Standard: Asia/Kolkata (IST)</span>
        </div>
      </footer>
    </div>
  );
}
