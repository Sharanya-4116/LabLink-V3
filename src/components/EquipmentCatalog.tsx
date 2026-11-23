import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { DateTime } from 'luxon';
import type {
  AlternativeSlot,
  Department,
  Equipment,
  MaintenanceWindow,
  Reservation,
  User,
} from '../../shared/types.ts';
import {
  formatCampusSlotRange,
  fromCampusDatetimeLocalValue,
  toCampusDatetimeLocalValue,
} from '../../shared/timezone.ts';
import { api, ApiClientError } from '../lib/api.ts';
import { EquipmentImage } from './EquipmentImage.tsx';
import { EquipmentOnboardingModal } from './EquipmentOnboardingModal.tsx';
import { StatusText } from './StatusText.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { SurfaceCard } from './ui/SurfaceCard.tsx';

interface EquipmentCatalogProps {
  currentUser: User;
  departments: Department[];
  initialSelectedEquipmentId?: string | null;
  initialSearchQuery?: string;
  initialCertifiedOnly?: boolean;
  initialDepartmentId?: string;
  onBookingCreated: () => Promise<void>;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function EquipmentCatalog({
  currentUser,
  departments,
  initialSelectedEquipmentId = null,
  initialSearchQuery = '',
  initialCertifiedOnly = false,
  initialDepartmentId = '',
  onBookingCreated,
}: EquipmentCatalogProps) {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState(initialSearchQuery);
  const [deptFilter, setDeptFilter] = useState(initialDepartmentId);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [certifiedOnly, setCertifiedOnly] = useState(initialCertifiedOnly);

  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);
  const [scheduleData, setScheduleData] = useState<{
    reservations: Reservation[];
    maintenanceWindows: MaintenanceWindow[];
    alternativeSlots: AlternativeSlot[];
  } | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // Booking form state
  const [projectTitle, setProjectTitle] = useState('');
  const [projectSummary, setProjectSummary] = useState('');
  const [requiredCapabilities, setRequiredCapabilities] = useState<string[]>([]);
  const [justification, setJustification] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [deadlineLocal, setDeadlineLocal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [onboardModalOpen, setOnboardModalOpen] = useState(false);
  const [onboardSuccess, setOnboardSuccess] = useState<string | null>(null);

  const canOnboardEquipment = currentUser.role === 'FACULTY' || currentUser.role === 'ADMIN';

  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  useEffect(() => {
    setSearch(initialSearchQuery);
  }, [initialSearchQuery]);

  useEffect(() => {
    setCertifiedOnly(initialCertifiedOnly);
  }, [initialCertifiedOnly]);

  useEffect(() => {
    setDeptFilter(initialDepartmentId);
  }, [initialDepartmentId]);

  async function loadCatalog() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getEquipment();
      setEquipment(res.equipment);
      if (initialSelectedEquipmentId) {
        const match = res.equipment.find((e) => e.id === initialSelectedEquipmentId);
        if (match) openEquipmentDrawer(match);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load equipment catalog');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCatalog();
  }, [currentUser.id]);

  useEffect(() => {
    if (initialSelectedEquipmentId && equipment.length > 0) {
      const match = equipment.find((e) => e.id === initialSelectedEquipmentId);
      if (match) openEquipmentDrawer(match);
    }
  }, [initialSelectedEquipmentId, equipment]);

  const categories = useMemo(
    () => Array.from(new Set(equipment.map((e) => e.category))).sort(),
    [equipment]
  );

  const hasActiveFilters = Boolean(
    search.trim() || deptFilter || categoryFilter || availableOnly || certifiedOnly
  );

  const filteredEquipment = useMemo(() => {
    return equipment.filter((eq) => {
      if (deptFilter && eq.departmentId !== deptFilter) return false;
      if (categoryFilter && eq.category !== categoryFilter) return false;
      if (availableOnly && eq.status !== 'AVAILABLE') return false;
      if (certifiedOnly) {
        const hasAll = eq.requiredCertifications.every((c) =>
          currentUser.certifications.includes(c)
        );
        if (!hasAll) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [
          eq.name,
          eq.assetTag,
          eq.category,
          eq.labRoom,
          ...eq.capabilities,
          ...Object.values(eq.specs),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [equipment, deptFilter, categoryFilter, availableOnly, certifiedOnly, search, currentUser.certifications]);

  const computedSessionHours = useMemo(() => {
    if (!startLocal || !endLocal) return null;
    try {
      const s = Date.parse(fromCampusDatetimeLocalValue(startLocal));
      const e = Date.parse(fromCampusDatetimeLocalValue(endLocal));
      if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
      return Math.round(((e - s) / 3_600_000) * 10) / 10;
    } catch {
      return null;
    }
  }, [startLocal, endLocal]);

  async function openEquipmentDrawer(eq: Equipment) {
    setSelectedEquipment(eq);
    setSubmitFeedback(null);
    setProjectTitle('');
    setProjectSummary('');
    setJustification('');
    setRequiredCapabilities(eq.capabilities.slice(0, Math.min(2, eq.capabilities.length)));

    let nextDay = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).startOf('day');
    for (let i = 0; i < 7; i++) {
      const dow = nextDay.weekday === 7 ? 0 : nextDay.weekday;
      if (eq.operatingHours.daysOfWeek.includes(dow)) break;
      nextDay = nextDay.plus({ days: 1 });
    }
    const defaultStart = nextDay.set({
      hour: Math.min(eq.operatingHours.startHour + 2, eq.operatingHours.endHour - 2),
      minute: 0,
    });
    const defaultEnd = defaultStart.plus({ hours: Math.min(2, eq.maxBookingHours) });
    const defaultDeadline = nextDay.plus({ days: 5 }).set({ hour: 18, minute: 0 });

    const sIso = defaultStart.toUTC().toISO()!;
    setStartLocal(toCampusDatetimeLocalValue(sIso));
    setEndLocal(toCampusDatetimeLocalValue(defaultEnd.toUTC().toISO()!));
    setDeadlineLocal(toCampusDatetimeLocalValue(defaultDeadline.toUTC().toISO()!));

    setScheduleLoading(true);
    try {
      const data = await api.getEquipmentSchedule(eq.id, sIso, 2);
      setScheduleData({
        reservations: data.reservations,
        maintenanceWindows: data.maintenanceWindows,
        alternativeSlots: data.alternativeSlots,
      });
    } catch {
      setScheduleData({ reservations: [], maintenanceWindows: [], alternativeSlots: [] });
    } finally {
      setScheduleLoading(false);
    }
  }

  async function refreshPreviewSlots() {
    if (!selectedEquipment || !startLocal || !endLocal) return;
    try {
      const startIso = fromCampusDatetimeLocalValue(startLocal);
      const endIso = fromCampusDatetimeLocalValue(endLocal);
      const dur = Math.max(0.5, (Date.parse(endIso) - Date.parse(startIso)) / 3_600_000);
      const data = await api.getEquipmentSchedule(selectedEquipment.id, startIso, dur);
      setScheduleData({
        reservations: data.reservations,
        maintenanceWindows: data.maintenanceWindows,
        alternativeSlots: data.alternativeSlots,
      });
    } catch {
      // ignore preview parse error
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && selectedEquipment) {
        setSelectedEquipment(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedEquipment]);

  async function handleSubmitBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEquipment) return;
    setSubmitFeedback(null);
    setSubmitting(true);

    try {
      const requestedStart = fromCampusDatetimeLocalValue(startLocal);
      const requestedEnd = fromCampusDatetimeLocalValue(endLocal);
      const projectDeadline = fromCampusDatetimeLocalValue(deadlineLocal);

      const res = await api.createBooking({
        equipmentId: selectedEquipment.id,
        projectTitle,
        projectSummary,
        requiredCapabilities,
        justification,
        requestedStart,
        requestedEnd,
        projectDeadline,
      });

      await onBookingCreated();
      const snap = res.booking.smartFairSnapshot;
      setSubmitFeedback({
        type: 'success',
        message: snap?.eligible
          ? `Request submitted (${res.booking.status}) · SmartFair Score: ${snap.score.toFixed(1)}/100.`
          : `Request submitted in CONFLICT_REVIEW (${snap?.violations.map((v) => v.code).join(', ') || 'Check constraints'}). See Command Center for alternative slots.`,
      });
      await refreshPreviewSlots();
    } catch (err) {
      const msg =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : 'Failed to submit booking request';
      setSubmitFeedback({ type: 'error', message: msg });
    } finally {
      setSubmitting(false);
    }
  }

  function toggleCapability(cap: string) {
    setRequiredCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  }

  function resetAllFilters() {
    setSearch('');
    setDeptFilter('');
    setCategoryFilter('');
    setAvailableOnly(false);
    setCertifiedOnly(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        variant="default"
        kicker="Campus Shared Inventory"
        title="Cross-Department Equipment Catalog"
        description="Inspect technical specifications, safety certification requirements, and submit project bookings."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#475569] bg-[#F3F6FA] border border-[#DCE4EE] rounded-xl hover:text-[#0F172A] hover:bg-white transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reset Filters</span>
              </button>
            )}
            <div className="text-xs font-mono font-semibold text-[#0F172A] bg-[#F3F6FA] border border-[#DCE4EE] px-3.5 py-2 rounded-xl tabular-nums">
              {filteredEquipment.length} / {equipment.length} assets
            </div>
            {canOnboardEquipment && (
              <button
                type="button"
                onClick={() => {
                  setOnboardSuccess(null);
                  setOnboardModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Onboard Equipment</span>
              </button>
            )}
          </div>
        }
      />

      {onboardSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="p-3.5 rounded-xl text-xs border bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]"
        >
          {onboardSuccess}
        </div>
      )}

      {/* Filters Bar */}
      <SurfaceCard className="p-4 sm:p-5 space-y-4 bg-white/95">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
          <div className="md:col-span-5 relative">
            <Search
              className="w-4 h-4 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search equipment by name, asset tag, capability, or room"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search 3D printers, oscilloscopes, FPGA, CUDA..."
              className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl focus:bg-white transition-colors"
            />
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Filter by department"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4 flex flex-wrap items-center gap-5 px-1">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#334155] cursor-pointer">
              <input
                type="checkbox"
                checked={availableOnly}
                onChange={(e) => setAvailableOnly(e.target.checked)}
                className="rounded border-[#CBD5E1]"
              />
              <span>Available Only</span>
            </label>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#334155] cursor-pointer">
              <input
                type="checkbox"
                checked={certifiedOnly}
                onChange={(e) => setCertifiedOnly(e.target.checked)}
                className="rounded border-[#CBD5E1]"
              />
              <span>Certification Match Only</span>
            </label>
          </div>
        </div>

        {/* Interactive Category Segmented Control */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#DCE4EE]">
          <button
            type="button"
            onClick={() => setCategoryFilter('')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              categoryFilter === ''
                ? 'bg-[#0B132B] text-white shadow-2xs'
                : 'bg-[#F3F6FA] text-[#475569] border border-[#DCE4EE] hover:text-[#0F172A] hover:bg-white'
            }`}
          >
            All Categories
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-[#0B132B] text-white shadow-2xs'
                  : 'bg-[#F3F6FA] text-[#475569] border border-[#DCE4EE] hover:text-[#0F172A] hover:bg-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </SurfaceCard>

      {/* Loading / Error / Empty / Populated States */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <div key={n} className="surface-card rounded-2xl overflow-hidden animate-pulse">
              <div className="aspect-[4/3] bg-[#E2E8F0]" />
              <div className="p-5 space-y-3">
                <div className="h-3 w-28 bg-[#E2E8F0] rounded" />
                <div className="h-5 w-3/4 bg-[#E2E8F0] rounded" />
                <div className="h-3 w-1/2 bg-[#F1F5F9] rounded" />
                <div className="h-9 w-full bg-[#E2E8F0] rounded-xl mt-4" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 text-sm text-[#B91C1C]">
          {error}
        </div>
      ) : filteredEquipment.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title="No equipment matches your active filters"
          description="Try clearing your search query, switching departments, or disabling the certification match filter."
          action={
            <button
              type="button"
              onClick={resetAllFilters}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8]"
            >
              Reset All Filters
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEquipment.map((eq) => {
            const dept = deptById.get(eq.departmentId);
            const missingCerts = eq.requiredCertifications.filter(
              (c) => !currentUser.certifications.includes(c)
            );
            const specEntries = Object.entries(eq.specs).slice(0, 2);

            return (
              <article
                key={eq.id}
                className="group surface-card-interactive rounded-2xl overflow-hidden flex flex-col"
              >
                <div className="relative aspect-[4/3] bg-[#0B132B] border-b border-[#E2E8F0] overflow-hidden">
                  <EquipmentImage
                    src={eq.imageUrl}
                    alt={eq.name}
                    title={eq.name}
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0B132B]/90 via-[#0B132B]/40 to-transparent px-4 py-2.5 flex items-center justify-between text-xs font-mono text-white">
                    <span className="font-semibold">{dept?.code ?? eq.departmentId}</span>
                    <span className="text-[#CBD5E1]">{eq.assetTag}</span>
                  </div>
                </div>

                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <StatusText status={eq.status} />
                    <span className="font-mono text-[#64748B]">{eq.category}</span>
                  </div>

                  <h3 className="font-display text-base font-bold text-[#0F172A] mt-2 leading-snug">
                    {eq.name}
                  </h3>

                  <div className="flex items-center gap-1.5 text-xs text-[#475569] mt-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#64748B] shrink-0" aria-hidden="true" />
                    <span className="truncate">{eq.labRoom}</span>
                  </div>

                  <div className="mt-3.5 pt-3.5 border-t border-[#E2E8F0] grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-[#64748B]">Max Session · Capacity</div>
                      <div className="font-mono font-semibold text-[#0F172A] tabular-nums mt-0.5">
                        {eq.maxBookingHours}h · {eq.capacity} bench{eq.capacity > 1 ? 'es' : ''}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#64748B]">Operating Hours</div>
                      <div className="font-mono font-semibold text-[#0F172A] tabular-nums mt-0.5">
                        {String(eq.operatingHours.startHour).padStart(2, '0')}:00–
                        {String(eq.operatingHours.endHour).padStart(2, '0')}:00 IST
                      </div>
                    </div>
                  </div>

                  {specEntries.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[#F1F5F9] text-xs text-[#475569] space-y-1">
                      {specEntries.map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2 truncate">
                          <span className="text-[#64748B]">{k}</span>
                          <span className="font-mono font-medium text-[#0F172A] truncate">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 pt-3 border-t border-[#E2E8F0] text-xs space-y-1.5">
                    <div className="text-[#475569] line-clamp-1">
                      <span className="font-semibold text-[#0F172A]">Capabilities:</span>{' '}
                      {eq.capabilities.join(' · ')}
                    </div>
                    <div className="flex items-start gap-1.5">
                      <ShieldCheck
                        className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                          missingCerts.length === 0 ? 'text-[#059669]' : 'text-[#B45309]'
                        }`}
                        aria-hidden="true"
                      />
                      {missingCerts.length === 0 ? (
                        <span className="text-[#059669] font-semibold">
                          All clearances met ({eq.requiredCertifications.join(', ')})
                        </span>
                      ) : (
                        <span className="text-[#B45309] font-semibold">
                          Missing clearance: {missingCerts.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-auto pt-4">
                    <button
                      type="button"
                      onClick={() => openEquipmentDrawer(eq)}
                      className="w-full px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] active:scale-[0.99] transition-all"
                    >
                      View Specs &amp; Book Equipment
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Detail & Booking Modal/Drawer */}
      {selectedEquipment && (
        <div
          className="fixed inset-0 z-50 bg-[#0B132B]/55 backdrop-blur-[2px] flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-title"
        >
          <div className="w-full max-w-2xl bg-white h-full overflow-y-auto border-l border-[#E2E8F0] flex flex-col">
            <div className="bg-[#0B132B] text-white px-6 sm:px-7 py-5 flex items-start justify-between gap-4 border-b border-[#1E293B]">
              <div>
                <div className="text-xs font-mono text-[#38BDF8]">
                  {deptById.get(selectedEquipment.departmentId)?.name} · {selectedEquipment.assetTag}
                </div>
                <h3 id="drawer-title" className="font-display text-xl font-bold text-white mt-1">
                  {selectedEquipment.name}
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[#CBD5E1]">
                  <span>{selectedEquipment.status}</span>
                  <span aria-hidden="true">·</span>
                  <span>{selectedEquipment.labRoom}</span>
                  <span aria-hidden="true">·</span>
                  <span>Capacity {selectedEquipment.capacity}</span>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close equipment drawer"
                onClick={() => setSelectedEquipment(null)}
                className="p-2 text-[#94A3B8] hover:text-white rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 sm:p-7 space-y-6 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-2">
                  <div className="font-semibold text-[#0F172A]">Technical Specifications</div>
                  {Object.entries(selectedEquipment.specs).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2 border-t border-[#E2E8F0] pt-1.5">
                      <span className="text-[#64748B]">{k}</span>
                      <span className="font-mono font-medium text-[#0F172A] text-right">{v}</span>
                    </div>
                  ))}
                </div>

                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-2">
                  <div className="font-semibold text-[#0F172A]">Operating Rules (Asia/Kolkata)</div>
                  <div className="text-[#475569] border-t border-[#E2E8F0] pt-1.5">
                    Hours:{' '}
                    <span className="font-mono font-medium text-[#0F172A]">
                      {String(selectedEquipment.operatingHours.startHour).padStart(2, '0')}:00–
                      {String(selectedEquipment.operatingHours.endHour).padStart(2, '0')}:00 IST
                    </span>
                  </div>
                  <div className="text-[#475569]">
                    Days:{' '}
                    <span className="font-medium text-[#0F172A]">
                      {selectedEquipment.operatingHours.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ')}
                    </span>
                  </div>
                  <div className="text-[#475569]">
                    Max Duration:{' '}
                    <span className="font-mono font-medium text-[#0F172A]">
                      {selectedEquipment.maxBookingHours} hours
                    </span>
                  </div>
                  <div className="text-[#475569]">
                    Required Clearances:{' '}
                    <span className="font-mono font-medium text-[#0F172A]">
                      {selectedEquipment.requiredCertifications.join(', ') || 'None'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#E2E8F0] pt-5">
                <h4 className="text-sm font-semibold text-[#0F172A] mb-2.5">
                  Active Schedule &amp; Maintenance Windows
                </h4>
                {scheduleLoading ? (
                  <p className="text-xs text-[#64748B]">Loading equipment schedule...</p>
                ) : (
                  <div className="space-y-2 text-xs">
                    {scheduleData?.reservations.length === 0 &&
                    scheduleData?.maintenanceWindows.length === 0 ? (
                      <p className="text-[#64748B]">
                        No confirmed reservations or maintenance blocks currently scheduled.
                      </p>
                    ) : (
                      <>
                        {scheduleData?.reservations.map((r) => (
                          <div
                            key={r.id}
                            className="flex items-center justify-between gap-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3.5 py-2.5"
                          >
                            <span className="font-mono text-[#0F172A] tabular-nums">
                              Bench #{r.benchNumber ?? 1} · {formatCampusSlotRange(r.startTime, r.endTime)}
                            </span>
                            <StatusText status={r.lifecycleStatus} />
                          </div>
                        ))}
                        {scheduleData?.maintenanceWindows.map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between gap-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3.5 py-2.5"
                          >
                            <div>
                              <div className="font-mono text-[#92400E] tabular-nums">
                                {formatCampusSlotRange(m.startTime, m.endTime)}
                              </div>
                              <div className="text-[#B45309]">{m.reason}</div>
                            </div>
                            <StatusText status="MAINTENANCE" />
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              <form onSubmit={handleSubmitBooking} className="border-t border-[#E2E8F0] pt-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-base font-display font-bold text-[#0F172A]">
                    Submit Project Booking Request
                  </h4>
                  <span className="text-xs text-[#64748B]">
                    Requesting as <strong className="text-[#0F172A]">{currentUser.name}</strong>
                  </span>
                </div>

                <div>
                  <label htmlFor="bk-title" className="block text-xs font-medium text-[#334155] mb-1">
                    Project Title
                  </label>
                  <input
                    id="bk-title"
                    type="text"
                    required
                    minLength={4}
                    value={projectTitle}
                    onChange={(e) => setProjectTitle(e.target.value)}
                    placeholder="e.g., Autonomous Rover Suspension Bracket"
                    className="w-full px-3 py-2 text-sm bg-white border border-[#CBD5E1] rounded-lg"
                  />
                </div>

                <div>
                  <label htmlFor="bk-summary" className="block text-xs font-medium text-[#334155] mb-1">
                    Project Summary
                  </label>
                  <textarea
                    id="bk-summary"
                    required
                    minLength={10}
                    rows={2}
                    value={projectSummary}
                    onChange={(e) => setProjectSummary(e.target.value)}
                    placeholder="Describe the experiment, fabrication pass, or benchmark workflow..."
                    className="w-full px-3 py-2 text-sm bg-white border border-[#CBD5E1] rounded-lg"
                  />
                </div>

                <div>
                  <div className="block text-xs font-medium text-[#334155] mb-1.5">
                    Required Equipment Capabilities (SmartFair 25% Compatibility Fit)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedEquipment.capabilities.map((cap) => {
                      const checked = requiredCapabilities.includes(cap);
                      return (
                        <button
                          key={cap}
                          type="button"
                          onClick={() => toggleCapability(cap)}
                          className={`px-2.5 py-1 text-xs font-mono rounded-lg border transition-colors ${
                            checked
                              ? 'bg-[#EFF6FF] border-[#2563EB] text-[#1D4ED8] font-semibold'
                              : 'bg-white border-[#CBD5E1] text-[#475569]'
                          }`}
                        >
                          {cap}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="bk-just" className="block text-xs font-medium text-[#334155] mb-1">
                    Equipment Justification
                  </label>
                  <textarea
                    id="bk-just"
                    required
                    minLength={10}
                    rows={2}
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder="Why this specific laboratory equipment and time window are required..."
                    className="w-full px-3 py-2 text-sm bg-white border border-[#CBD5E1] rounded-lg"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="bk-start" className="block text-xs font-medium text-[#334155] mb-1">
                      Start (IST)
                    </label>
                    <input
                      id="bk-start"
                      type="datetime-local"
                      required
                      value={startLocal}
                      onChange={(e) => setStartLocal(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-[#CBD5E1] rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="bk-end" className="block text-xs font-medium text-[#334155] mb-1">
                      End (IST)
                    </label>
                    <input
                      id="bk-end"
                      type="datetime-local"
                      required
                      value={endLocal}
                      onChange={(e) => setEndLocal(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-[#CBD5E1] rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="bk-deadline" className="block text-xs font-medium text-[#334155] mb-1">
                      Project Deadline (IST)
                    </label>
                    <input
                      id="bk-deadline"
                      type="datetime-local"
                      required
                      value={deadlineLocal}
                      onChange={(e) => setDeadlineLocal(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-[#CBD5E1] rounded-lg"
                    />
                  </div>
                </div>

                {computedSessionHours !== null && (
                  <div className="flex items-center justify-between text-xs bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3.5 py-2.5">
                    <span className="text-[#475569]">Requested Session Duration</span>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        computedSessionHours > selectedEquipment.maxBookingHours
                          ? 'text-[#DC2626]'
                          : 'text-[#059669]'
                      }`}
                    >
                      {computedSessionHours}h / {selectedEquipment.maxBookingHours}h limit
                    </span>
                  </div>
                )}

                {scheduleData && scheduleData.alternativeSlots.length > 0 && (
                  <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-[#0F172A]">
                        Open Recommended Slots (Asia/Kolkata)
                      </span>
                      <button
                        type="button"
                        onClick={refreshPreviewSlots}
                        className="text-xs font-semibold text-[#2563EB] hover:underline"
                      >
                        Refresh Preview
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {scheduleData.alternativeSlots.map((slot) => (
                        <button
                          key={slot.startTime}
                          type="button"
                          onClick={() => {
                            setStartLocal(toCampusDatetimeLocalValue(slot.startTime));
                            setEndLocal(toCampusDatetimeLocalValue(slot.endTime));
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono text-[#1D4ED8] bg-white border border-[#BFDBFE] rounded-lg hover:bg-[#EFF6FF]"
                        >
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          <span>{slot.campusLabel}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {submitFeedback && (
                  <div
                    role="status"
                    aria-live="polite"
                    className={`p-3.5 rounded-xl text-xs border flex items-start gap-2 ${
                      submitFeedback.type === 'success'
                        ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
                        : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{submitFeedback.message}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedEquipment(null)}
                    className="px-4 py-2.5 text-xs font-medium text-[#475569] bg-white border border-[#CBD5E1] rounded-xl hover:bg-[#F8FAFC]"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || requiredCapabilities.length === 0}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{submitting ? 'Submitting...' : 'Submit Booking Request'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {canOnboardEquipment && (
        <EquipmentOnboardingModal
          open={onboardModalOpen}
          departments={departments}
          onClose={() => setOnboardModalOpen(false)}
          onCreated={async (eq) => {
            await Promise.all([loadCatalog(), onBookingCreated()]);
            setOnboardSuccess(`Registered "${eq.name}" (${eq.assetTag}) in shared catalog.`);
          }}
        />
      )}
    </div>
  );
}
