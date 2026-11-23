import { useEffect, useState } from 'react';
import { AlertCircle, Plus, Trash2, Wrench, X } from 'lucide-react';
import type { Department, Equipment, EquipmentStatus } from '../../shared/types.ts';
import { api, ApiClientError } from '../lib/api.ts';
import { EquipmentImage } from './EquipmentImage.tsx';

interface EquipmentOnboardingModalProps {
  open: boolean;
  departments: Department[];
  onClose: () => void;
  onCreated: (equipment: Equipment) => Promise<void>;
}

const CURATED_IMAGES = [
  {
    label: '3D Printer & Additive Fab',
    url: '/src/assets/images/equip_3d_printer_1795420979057.jpg',
  },
  {
    label: 'Oscilloscope & VLSI Bench',
    url: '/src/assets/images/equip_oscilloscope_1795420979264.jpg',
  },
  {
    label: 'GPU & Edge Compute Node',
    url: '/src/assets/images/equip_gpu_workstation_1795420979806.jpg',
  },
  {
    label: 'CNC & Robotics Cell',
    url: '/src/assets/images/equip_cnc_robotics_1795420980204.jpg',
  },
] as const;

const KNOWN_CERTIFICATIONS = [
  'LAB_SAFETY_101',
  'FAB_3D_PRINTING',
  'CNC_SAFETY_L1',
  'HV_OSCILLOSCOPE',
  'ESD_PROTECTION',
  'GPU_CLUSTER_AUTH',
];

const SUGGESTED_CAPABILITIES = [
  'multi-material',
  '5-axis-machining',
  'high-bandwidth-1ghz',
  'protocol-decode',
  'cuda-tensor',
  'ros2-control',
  'verilog-synthesis',
  'iot-telemetry',
];

const WEEKDAYS = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
];

export function EquipmentOnboardingModal({
  open,
  departments,
  onClose,
  onCreated,
}: EquipmentOnboardingModalProps) {
  const [name, setName] = useState('');
  const [assetTag, setAssetTag] = useState('');
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? '');
  const [category, setCategory] = useState('Oscilloscopes');
  const [labRoom, setLabRoom] = useState('');
  const [description, setDescription] = useState('');
  const [capacity, setCapacity] = useState(1);
  const [maxBookingHours, setMaxBookingHours] = useState(4);
  const [startHour, setStartHour] = useState(8);
  const [endHour, setEndHour] = useState(20);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [status, setStatus] = useState<EquipmentStatus>('AVAILABLE');
  const [imageUrl, setImageUrl] = useState<string>(CURATED_IMAGES[0].url);

  const [specRows, setSpecRows] = useState<Array<{ key: string; value: string }>>([
    { key: 'Accuracy', value: '±0.05 mm' },
  ]);

  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [customCapability, setCustomCapability] = useState('');
  const [requiredCertifications, setRequiredCertifications] = useState<string[]>(['LAB_SAFETY_101']);
  const [customCert, setCustomCert] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!departmentId && departments.length > 0) {
      setDepartmentId(departments[0].id);
    }
  }, [departments, departmentId]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  function toggleDay(day: number) {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  }

  function toggleCapability(cap: string) {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  }

  function addCustomCapability() {
    const clean = customCapability.trim().toLowerCase().replace(/\s+/g, '-');
    if (!clean) return;
    if (!capabilities.includes(clean)) {
      setCapabilities((prev) => [...prev, clean]);
    }
    setCustomCapability('');
  }

  function toggleCertification(cert: string) {
    setRequiredCertifications((prev) =>
      prev.includes(cert) ? prev.filter((c) => c !== cert) : [...prev, cert]
    );
  }

  function addCustomCertification() {
    const clean = customCert.trim().toUpperCase().replace(/\s+/g, '_');
    if (!clean) return;
    if (!requiredCertifications.includes(clean)) {
      setRequiredCertifications((prev) => [...prev, clean]);
    }
    setCustomCert('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (daysOfWeek.length === 0) {
      setError('Select at least one operating day.');
      return;
    }
    if (endHour <= startHour) {
      setError('Closing hour must be strictly greater than opening hour.');
      return;
    }
    if (capabilities.length === 0) {
      setError('Add or select at least one equipment capability tag.');
      return;
    }

    const specs: Record<string, string> = {};
    for (const row of specRows) {
      const k = row.key.trim();
      const v = row.value.trim();
      if (k && v) specs[k] = v;
    }

    setSubmitting(true);
    try {
      const res = await api.createEquipment({
        assetTag: assetTag.trim().toUpperCase(),
        name: name.trim(),
        category: category.trim(),
        departmentId,
        labRoom: labRoom.trim(),
        description: description.trim(),
        specs,
        capabilities,
        requiredCertifications,
        maxBookingHours: Number(maxBookingHours),
        operatingHours: {
          startHour: Number(startHour),
          endHour: Number(endHour),
          daysOfWeek,
        },
        status,
        capacity: Number(capacity),
        imageUrl,
      });
      await onCreated(res.equipment);
      // Reset form cleanly only after verified persistence
      setName('');
      setAssetTag('');
      setLabRoom('');
      setDescription('');
      setCapabilities([]);
      setSpecRows([{ key: 'Accuracy', value: '±0.05 mm' }]);
      setError(null);
      onClose();
    } catch (err) {
      // Preserve all entered form state so the user can fix duplicate assetTag or validation errors
      const msg =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : 'Unable to onboard equipment';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0B132B]/60 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboard-modal-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-2xl my-auto max-h-[92vh] flex flex-col"
      >
        <div className="bg-[#0B132B] text-white px-6 py-4 flex items-start justify-between gap-4 shrink-0">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-[#38BDF8]">
              Faculty &amp; Admin Asset Registry
            </div>
            <h3 id="onboard-modal-title" className="font-display text-lg font-bold text-white mt-0.5">
              Onboard New Laboratory Equipment
            </h3>
          </div>
          <button
            type="button"
            disabled={submitting}
            aria-label="Close onboarding modal"
            onClick={onClose}
            className="p-1.5 text-[#94A3B8] hover:text-white rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {/* Core Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="eq-name" className="block font-semibold text-[#334155] mb-1">
                Equipment Name
              </label>
              <input
                id="eq-name"
                type="text"
                required
                minLength={3}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Keysight InfiniiVision DSOX3024T"
                className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="eq-tag" className="block font-semibold text-[#334155] mb-1">
                Unique Asset Tag
              </label>
              <input
                id="eq-tag"
                type="text"
                required
                minLength={3}
                maxLength={40}
                value={assetTag}
                onChange={(e) => setAssetTag(e.target.value.toUpperCase())}
                placeholder="e.g., ECE-SIG-12"
                className="w-full px-3 py-2 font-mono uppercase bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="eq-dept" className="block font-semibold text-[#334155] mb-1">
                Department
              </label>
              <select
                id="eq-dept"
                required
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="eq-cat" className="block font-semibold text-[#334155] mb-1">
                Category
              </label>
              <input
                id="eq-cat"
                type="text"
                required
                minLength={2}
                maxLength={60}
                list="eq-cat-suggestions"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
              />
              <datalist id="eq-cat-suggestions">
                <option value="3D Printers" />
                <option value="Oscilloscopes" />
                <option value="FPGA Boards" />
                <option value="GPU Workstations" />
                <option value="CNC Machines" />
                <option value="Robotics Kits" />
                <option value="Arduino Kits" />
                <option value="Raspberry Pi Kits" />
              </datalist>
            </div>

            <div>
              <label htmlFor="eq-room" className="block font-semibold text-[#334155] mb-1">
                Laboratory Room
              </label>
              <input
                id="eq-room"
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={labRoom}
                onChange={(e) => setLabRoom(e.target.value)}
                placeholder="e.g., A-204 Embedded Systems Wing"
                className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="eq-status" className="block font-semibold text-[#334155] mb-1">
                Initial Availability Status
              </label>
              <select
                id="eq-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as EquipmentStatus)}
                className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg font-semibold"
              >
                <option value="AVAILABLE">AVAILABLE</option>
                <option value="MAINTENANCE">MAINTENANCE</option>
                <option value="OFFLINE">OFFLINE</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="eq-desc" className="block font-semibold text-[#334155] mb-1">
              Technical Description
            </label>
            <textarea
              id="eq-desc"
              rows={2}
              maxLength={600}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Summarize primary research applications, safety notes, and bench configuration..."
              className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
            />
          </div>

          {/* Capacity & Operating Schedule (Asia/Kolkata) */}
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-3">
            <div className="font-semibold text-[#0F172A] flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-[#2563EB]" aria-hidden="true" />
              <span>Bench Capacity &amp; Asia/Kolkata Operating Schedule</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label htmlFor="eq-cap" className="block font-medium text-[#475569] mb-1">
                  Bench Capacity
                </label>
                <input
                  id="eq-cap"
                  type="number"
                  min={1}
                  max={20}
                  required
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 font-mono bg-white border border-[#CBD5E1] rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="eq-maxh" className="block font-medium text-[#475569] mb-1">
                  Max Session (h)
                </label>
                <input
                  id="eq-maxh"
                  type="number"
                  min={0.5}
                  max={24}
                  step={0.5}
                  required
                  value={maxBookingHours}
                  onChange={(e) => setMaxBookingHours(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 font-mono bg-white border border-[#CBD5E1] rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="eq-starth" className="block font-medium text-[#475569] mb-1">
                  Open Hour (IST)
                </label>
                <input
                  id="eq-starth"
                  type="number"
                  min={0}
                  max={23}
                  required
                  value={startHour}
                  onChange={(e) => setStartHour(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 font-mono bg-white border border-[#CBD5E1] rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="eq-endh" className="block font-medium text-[#475569] mb-1">
                  Close Hour (IST)
                </label>
                <input
                  id="eq-endh"
                  type="number"
                  min={1}
                  max={24}
                  required
                  value={endHour}
                  onChange={(e) => setEndHour(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 font-mono bg-white border border-[#CBD5E1] rounded-lg"
                />
              </div>
            </div>

            <div>
              <div className="font-medium text-[#475569] mb-1.5">Active Operating Days</div>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w) => {
                  const active = daysOfWeek.includes(w.day);
                  return (
                    <button
                      key={w.day}
                      type="button"
                      onClick={() => toggleDay(w.day)}
                      className={`px-2.5 py-1 rounded-lg border font-mono font-semibold transition-colors ${
                        active
                          ? 'bg-[#0B132B] text-white border-[#0B132B]'
                          : 'bg-white text-[#64748B] border-[#CBD5E1]'
                      }`}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Capabilities */}
          <div className="space-y-2">
            <div className="font-semibold text-[#334155]">
              Equipment Capabilities (SmartFair Compatibility Tags)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(new Set([...SUGGESTED_CAPABILITIES, ...capabilities])).map((cap) => {
                const selected = capabilities.includes(cap);
                return (
                  <button
                    key={cap}
                    type="button"
                    onClick={() => toggleCapability(cap)}
                    className={`px-2.5 py-1 font-mono rounded-lg border transition-colors ${
                      selected
                        ? 'bg-[#EFF6FF] border-[#2563EB] text-[#1D4ED8] font-semibold'
                        : 'bg-[#F8FAFC] border-[#CBD5E1] text-[#475569]'
                    }`}
                  >
                    {selected ? '✓ ' : '+ '}
                    {cap}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                aria-label="Custom capability tag"
                value={customCapability}
                onChange={(e) => setCustomCapability(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomCapability();
                  }
                }}
                placeholder="Add custom tag (e.g., thermal-imaging)"
                className="flex-1 px-3 py-1.5 font-mono bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
              />
              <button
                type="button"
                onClick={addCustomCapability}
                className="px-3 py-1.5 font-semibold text-[#0F172A] bg-[#F1F5F9] border border-[#CBD5E1] rounded-lg hover:bg-[#E2E8F0]"
              >
                Add Tag
              </button>
            </div>
          </div>

          {/* Required Certifications */}
          <div className="space-y-2">
            <div className="font-semibold text-[#334155]">Required Safety Certifications</div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(new Set([...KNOWN_CERTIFICATIONS, ...requiredCertifications])).map(
                (cert) => {
                  const selected = requiredCertifications.includes(cert);
                  return (
                    <button
                      key={cert}
                      type="button"
                      onClick={() => toggleCertification(cert)}
                      className={`px-2.5 py-1 font-mono rounded-lg border transition-colors ${
                        selected
                          ? 'bg-[#ECFDF5] border-[#059669] text-[#065F46] font-semibold'
                          : 'bg-[#F8FAFC] border-[#CBD5E1] text-[#475569]'
                      }`}
                    >
                      {selected ? '✓ ' : '+ '}
                      {cert}
                    </button>
                  );
                }
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                aria-label="Custom certification code"
                value={customCert}
                onChange={(e) => setCustomCert(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomCertification();
                  }
                }}
                placeholder="Add custom clearance (e.g., LASER_CLASS_3B)"
                className="flex-1 px-3 py-1.5 font-mono bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
              />
              <button
                type="button"
                onClick={addCustomCertification}
                className="px-3 py-1.5 font-semibold text-[#0F172A] bg-[#F1F5F9] border border-[#CBD5E1] rounded-lg hover:bg-[#E2E8F0]"
              >
                Add Clearance
              </button>
            </div>
          </div>

          {/* Technical Specs KV Editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#334155]">Technical Specifications (Key / Value)</span>
              <button
                type="button"
                onClick={() => setSpecRows((prev) => [...prev, { key: '', value: '' }])}
                className="inline-flex items-center gap-1 font-semibold text-[#2563EB] hover:underline"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add Spec Row</span>
              </button>
            </div>
            <div className="space-y-2">
              {specRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Key (e.g., Bandwidth)"
                    aria-label={`Specification key ${idx + 1}`}
                    value={row.key}
                    onChange={(e) =>
                      setSpecRows((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r))
                      )
                    }
                    className="w-2/5 px-2.5 py-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
                  />
                  <input
                    type="text"
                    placeholder="Value (e.g., 200 MHz)"
                    aria-label={`Specification value ${idx + 1}`}
                    value={row.value}
                    onChange={(e) =>
                      setSpecRows((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r))
                      )
                    }
                    className="flex-1 px-2.5 py-1.5 font-mono bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
                  />
                  <button
                    type="button"
                    aria-label={`Remove specification ${idx + 1}`}
                    onClick={() => setSpecRows((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1.5 text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Curated Local Asset Image Selector */}
          <div className="space-y-2">
            <div className="font-semibold text-[#334155]">Curated Laboratory Asset Photograph</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {CURATED_IMAGES.map((img) => {
                const selected = imageUrl === img.url;
                return (
                  <button
                    key={img.url}
                    type="button"
                    onClick={() => setImageUrl(img.url)}
                    className={`rounded-xl border overflow-hidden text-left transition-all ${
                      selected
                        ? 'border-[#2563EB] ring-2 ring-[#2563EB]/25'
                        : 'border-[#CBD5E1] opacity-80 hover:opacity-100'
                    }`}
                  >
                    <div className="aspect-[16/10] bg-[#0B132B]">
                      <EquipmentImage
                        src={img.url}
                        alt={img.label}
                        title={img.label}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="px-2 py-1.5 text-[11px] font-semibold text-[#0F172A] truncate bg-white">
                      {img.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-[#F8FAFC] border-t border-[#E2E8F0] flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-[#475569] bg-white border border-[#CBD5E1] rounded-xl hover:bg-[#F1F5F9]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {submitting ? 'Registering Equipment...' : 'Register Equipment'}
          </button>
        </div>
      </form>
    </div>
  );
}
