import { DateTime } from 'luxon';
import type {
  AuditLog,
  BookingRequest,
  Department,
  Equipment,
  MaintenanceWindow,
  Reservation,
  SlotLock,
  User,
} from '../shared/types.ts';
import { computeSlotBucketIds } from '../shared/timezone.ts';

export interface SeedBundle {
  departments: Department[];
  users: User[];
  equipment: Equipment[];
  bookingRequests: BookingRequest[];
  reservations: Reservation[];
  maintenanceWindows: MaintenanceWindow[];
  slotLocks: SlotLock[];
  auditLogs: AuditLog[];
}

/**
 * Generates deterministic, realistic campus seed data anchored to upcoming operating days
 * in Asia/Kolkata so evaluators always see live conflicts, maintenance blocks, and schedules.
 */
export function buildSeedData(campusTimezone = 'Asia/Kolkata'): SeedBundle {
  const nowIst = DateTime.now().setZone(campusTimezone);

  // Find next weekday (Mon-Fri) starting tomorrow so operatingHours [1,2,3,4,5] are always valid
  const nextWeekday = (offsetFromTomorrow: number): DateTime => {
    let dt = nowIst.plus({ days: 1 + offsetFromTomorrow }).startOf('day');
    while (dt.weekday === 6 || dt.weekday === 7) {
      dt = dt.plus({ days: 1 });
    }
    return dt;
  };

  const day1 = nextWeekday(0);
  const day2 = nextWeekday(1);
  const yesterday = nowIst.minus({ days: 1 }).startOf('day');
  const twoDaysAgo = nowIst.minus({ days: 2 }).startOf('day');

  const isoAt = (day: DateTime, hour: number, minute = 0) =>
    day.set({ hour, minute, second: 0, millisecond: 0 }).toUTC().toISO()!;

  const departments: Department[] = [
    {
      id: 'dept-mech',
      code: 'MECH',
      name: 'Mechanical & Aerospace Engineering',
      building: 'Block C · Precision Fabrication Wing',
      contactEmail: 'mech-labs@campus.edu',
    },
    {
      id: 'dept-ece',
      code: 'ECE',
      name: 'Electronics & Embedded Systems',
      building: 'Block A · Signals & VLSI Center',
      contactEmail: 'ece-labs@campus.edu',
    },
    {
      id: 'dept-csai',
      code: 'CSAI',
      name: 'Computing & Artificial Intelligence',
      building: 'Block D · High-Performance Compute Annex',
      contactEmail: 'csai-labs@campus.edu',
    },
    {
      id: 'dept-robo',
      code: 'ROBO',
      name: 'Robotics & Autonomous Mechatronics',
      building: 'Block B · Autonomous Systems Arena',
      contactEmail: 'robo-labs@campus.edu',
    },
  ];

  const users: User[] = [
    {
      id: 'usr-stu-aarav',
      email: 'aarav.mehta@campus.edu',
      name: 'Aarav Mehta',
      role: 'STUDENT',
      departmentId: 'dept-robo',
      certifications: ['LAB_SAFETY_101', 'FAB_3D_PRINTING', 'CNC_SAFETY_L1', 'ESD_PROTECTION'],
      rolling30DayHoursUsed: 6.5,
      createdAt: nowIst.minus({ days: 45 }).toUTC().toISO()!,
    },
    {
      id: 'usr-stu-diya',
      email: 'diya.sharma@campus.edu',
      name: 'Diya Sharma',
      role: 'STUDENT',
      departmentId: 'dept-ece',
      certifications: ['LAB_SAFETY_101', 'FAB_3D_PRINTING', 'HV_OSCILLOSCOPE', 'ESD_PROTECTION'],
      rolling30DayHoursUsed: 18.0,
      createdAt: nowIst.minus({ days: 60 }).toUTC().toISO()!,
    },
    {
      id: 'usr-stu-kabir',
      email: 'kabir.patel@campus.edu',
      name: 'Kabir Patel',
      role: 'STUDENT',
      departmentId: 'dept-csai',
      certifications: ['LAB_SAFETY_101', 'GPU_CLUSTER_AUTH'],
      rolling30DayHoursUsed: 4.0,
      createdAt: nowIst.minus({ days: 30 }).toUTC().toISO()!,
    },
    {
      id: 'usr-fac-ananya',
      email: 'ananya.rao@campus.edu',
      name: 'Dr. Ananya Rao',
      role: 'FACULTY',
      departmentId: 'dept-ece',
      certifications: ['LAB_SAFETY_101', 'HV_OSCILLOSCOPE', 'ESD_PROTECTION', 'FACULTY_SUPERVISOR'],
      rolling30DayHoursUsed: 0,
      createdAt: nowIst.minus({ days: 180 }).toUTC().toISO()!,
    },
    {
      id: 'usr-fac-vikram',
      email: 'vikram.nair@campus.edu',
      name: 'Prof. Vikram Nair',
      role: 'FACULTY',
      departmentId: 'dept-mech',
      certifications: ['LAB_SAFETY_101', 'FAB_3D_PRINTING', 'CNC_SAFETY_L1', 'FACULTY_SUPERVISOR'],
      rolling30DayHoursUsed: 0,
      createdAt: nowIst.minus({ days: 220 }).toUTC().toISO()!,
    },
    {
      id: 'usr-adm-meera',
      email: 'meera.krishnan@campus.edu',
      name: 'Meera Krishnan',
      role: 'ADMIN',
      departmentId: 'dept-csai',
      certifications: ['LAB_SAFETY_101', 'CAMPUS_DIRECTOR'],
      rolling30DayHoursUsed: 0,
      createdAt: nowIst.minus({ days: 365 }).toUTC().toISO()!,
    },
  ];

  const equipment: Equipment[] = [
    {
      id: 'eq-polymax-3d',
      assetTag: 'MECH-FAB-01',
      name: 'PolyMax i600 Multi-Material 3D Printer',
      category: '3D Printers',
      departmentId: 'dept-mech',
      labRoom: 'C-204 Rapid Prototyping Lab',
      description: 'Dual-extruder industrial FFF printer for carbon-nylon composites and soluble PVA geometries.',
      specs: {
        BuildVolume: '400 × 400 × 450 mm',
        Extruders: 'Dual Independent IDEX',
        Materials: 'Carbon-Nylon, PETG, TPU, PVA Support',
        LayerPrecision: '50 microns',
      },
      capabilities: ['multi-material', 'carbon-fiber-nylon', 'soluble-support', 'large-format'],
      requiredCertifications: ['LAB_SAFETY_101', 'FAB_3D_PRINTING'],
      maxBookingHours: 6,
      operatingHours: { startHour: 8, endHour: 20, daysOfWeek: [1, 2, 3, 4, 5, 6] },
      status: 'AVAILABLE',
      capacity: 1,
      imageUrl: '/src/assets/images/equip_3d_printer_1795420979057.jpg',
    },
    {
      id: 'eq-tek-mso54',
      assetTag: 'ECE-SIG-04',
      name: 'Tektronix MSO54 Digital Oscilloscope',
      category: 'Oscilloscopes',
      departmentId: 'dept-ece',
      labRoom: 'A-108 Signal Integrity Bench',
      specs: {
        Bandwidth: '1 GHz · 4 FlexChannel Inputs',
        SampleRate: '6.25 GS/s',
        MemoryDepth: '62.5 Mpoints',
        ProtocolDecode: 'SPI, I2C, CAN-FD, UART',
      },
      capabilities: ['high-bandwidth-1ghz', 'mixed-signal-logic', 'protocol-decode', 'differential-probe'],
      requiredCertifications: ['LAB_SAFETY_101', 'HV_OSCILLOSCOPE'],
      maxBookingHours: 4,
      operatingHours: { startHour: 9, endHour: 19, daysOfWeek: [1, 2, 3, 4, 5] },
      status: 'AVAILABLE',
      capacity: 1,
      imageUrl: '/src/assets/images/equip_oscilloscope_1795420979264.jpg',
    },
    {
      id: 'eq-fpga-kintex',
      assetTag: 'ECE-VLSI-07',
      name: 'Xilinx Kintex-7 FPGA Prototyping Station',
      category: 'FPGA Boards',
      departmentId: 'dept-ece',
      labRoom: 'A-212 Reconfigurable Computing Lab',
      specs: {
        Device: 'XC7K325T-2FFG900I',
        Transceivers: '8 × GTX 12.5 Gbps',
        Memory: '2 GB DDR3 SODIMM',
        Toolchain: 'Vivado ML Enterprise',
      },
      capabilities: ['high-speed-serdes', 'hardware-dsp', 'pcie-gen2', 'verilog-synthesis'],
      requiredCertifications: ['LAB_SAFETY_101', 'ESD_PROTECTION'],
      maxBookingHours: 6,
      operatingHours: { startHour: 8, endHour: 21, daysOfWeek: [1, 2, 3, 4, 5, 6] },
      status: 'AVAILABLE',
      capacity: 2,
      imageUrl: '/src/assets/images/equip_oscilloscope_1795420979264.jpg',
    },
    {
      id: 'eq-gpu-ws1',
      assetTag: 'CSAI-GPU-02',
      name: 'Dual-RTX 4090 CUDA AI & CAD Workstation',
      category: 'GPU Workstations',
      departmentId: 'dept-csai',
      labRoom: 'D-301 Compute Cluster Room',
      specs: {
        GPUs: '2 × NVIDIA RTX 4090 (48 GB VRAM total)',
        CPU: 'AMD Threadripper PRO 5975WX (32 Cores)',
        RAM: '256 GB DDR4 ECC',
        Storage: '4 TB NVMe Gen4 RAID',
      },
      capabilities: ['multi-gpu-training', 'cuda-tensor', 'cfd-simulation', 'large-vram-48gb'],
      requiredCertifications: ['LAB_SAFETY_101', 'GPU_CLUSTER_AUTH'],
      maxBookingHours: 8,
      operatingHours: { startHour: 8, endHour: 22, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
      status: 'AVAILABLE',
      capacity: 1,
      imageUrl: '/src/assets/images/equip_gpu_workstation_1795420979806.jpg',
    },
    {
      id: 'eq-pocket-cnc',
      assetTag: 'MECH-CNC-03',
      name: 'Pocket NC V2-50 5-Axis Desktop CNC Mill',
      category: 'CNC Machines',
      departmentId: 'dept-mech',
      labRoom: 'C-110 Subtractive Machining Bay',
      specs: {
        Axes: 'Simultaneous 5-Axis (X, Y, Z, A, B)',
        Spindle: '50,000 RPM High-Speed Air Bearing',
        Tolerance: '±0.025 mm',
        Materials: '6061 Aluminum, Brass, Delrin, Acrylic',
      },
      capabilities: ['5-axis-machining', 'aluminum-milling', 'micro-tolerance', 'cam-postprocessing'],
      requiredCertifications: ['LAB_SAFETY_101', 'CNC_SAFETY_L1'],
      maxBookingHours: 5,
      operatingHours: { startHour: 9, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5] },
      status: 'AVAILABLE',
      capacity: 1,
      imageUrl: '/src/assets/images/equip_cnc_robotics_1795420980204.jpg',
    },
    {
      id: 'eq-dobot-cr5',
      assetTag: 'ROBO-ARM-05',
      name: 'Dobot CR5 6-DOF Collaborative Robotics Kit',
      category: 'Robotics Kits',
      departmentId: 'dept-robo',
      labRoom: 'B-104 Autonomous Manipulation Arena',
      specs: {
        Payload: '5 kg · 900 mm Reach',
        Repeatability: '±0.02 mm',
        Interfaces: 'ROS 2 Humble, Modbus TCP, Python SDK',
        EndEffector: 'Adaptive 2-Finger Servo Gripper + Depth Cam',
      },
      capabilities: ['6-dof-kinematics', 'ros2-control', 'force-torque-sensing', 'vision-servo'],
      requiredCertifications: ['LAB_SAFETY_101'],
      maxBookingHours: 5,
      operatingHours: { startHour: 9, endHour: 20, daysOfWeek: [1, 2, 3, 4, 5, 6] },
      status: 'AVAILABLE',
      capacity: 1,
      imageUrl: '/src/assets/images/equip_cnc_robotics_1795420980204.jpg',
    },
    {
      id: 'eq-arduino-telemetry',
      assetTag: 'ECE-DEV-11',
      name: 'Arduino & Sensor Telemetry Dev Kit Bench',
      category: 'Arduino Kits',
      departmentId: 'dept-ece',
      labRoom: 'A-102 Embedded IoT Studio',
      specs: {
        Controllers: 'Arduino Portenta H7 + Nano 33 BLE Sense',
        Sensors: 'IMU, LiDAR ToF, BME680, LoRaWAN Shield',
        Power: 'Dual Benchtop Programmable PSU',
      },
      capabilities: ['iot-telemetry', 'lorawan-mesh', 'ble-prototyping', 'edge-imu'],
      requiredCertifications: ['LAB_SAFETY_101'],
      maxBookingHours: 6,
      operatingHours: { startHour: 8, endHour: 21, daysOfWeek: [1, 2, 3, 4, 5, 6] },
      status: 'AVAILABLE',
      capacity: 4,
      imageUrl: '/src/assets/images/equip_oscilloscope_1795420979264.jpg',
    },
    {
      id: 'eq-rpi-edge',
      assetTag: 'CSAI-RPI-09',
      name: 'Raspberry Pi 5 Edge-Vision Cluster Kit',
      category: 'Raspberry Pi Kits',
      departmentId: 'dept-csai',
      labRoom: 'D-205 Edge Systems Lab',
      specs: {
        Nodes: '4 × Raspberry Pi 5 (8 GB) + Coral M.2 TPU',
        Vision: 'Global Shutter CSI Camera Module',
        Networking: 'Managed PoE+ Gigabit Switch',
      },
      capabilities: ['edge-inference', 'poe-cluster', 'csi-vision', 'linux-embedded'],
      requiredCertifications: ['LAB_SAFETY_101'],
      maxBookingHours: 6,
      operatingHours: { startHour: 8, endHour: 20, daysOfWeek: [1, 2, 3, 4, 5] },
      status: 'MAINTENANCE',
      capacity: 2,
      imageUrl: '/src/assets/images/equip_gpu_workstation_1795420979806.jpg',
    },
  ];

  const maintenanceWindows: MaintenanceWindow[] = [
    {
      id: 'mnt-cnc-cal',
      equipmentId: 'eq-pocket-cnc',
      startTime: isoAt(day1, 14, 0),
      endTime: isoAt(day1, 16, 0),
      reason: 'Quarterly 5-axis rotary trunnion laser alignment & spindle lubrication',
      createdBy: 'usr-fac-vikram',
    },
    {
      id: 'mnt-rpi-flash',
      equipmentId: 'eq-rpi-edge',
      startTime: isoAt(day1, 9, 0),
      endTime: isoAt(day1, 13, 0),
      reason: 'NVMe HAT firmware upgrade across all 4 edge nodes',
      createdBy: 'usr-adm-meera',
    },
  ];

  // Seed historical & confirmed reservations
  const reservations: Reservation[] = [
    {
      id: 'res-hist-01',
      requestId: 'req-hist-01',
      equipmentId: 'eq-polymax-3d',
      studentId: 'usr-stu-diya',
      startTime: isoAt(twoDaysAgo, 10, 0),
      endTime: isoAt(twoDaysAgo, 14, 0),
      benchNumber: 1,
      lifecycleStatus: 'RETURNED',
      checkedOutAt: isoAt(twoDaysAgo, 10, 5),
      returnedAt: isoAt(twoDaysAgo, 13, 55),
      noShowMarkedAt: null,
    },
    {
      id: 'res-hist-02',
      requestId: 'req-hist-02',
      equipmentId: 'eq-tek-mso54',
      studentId: 'usr-stu-aarav',
      startTime: isoAt(yesterday, 11, 0),
      endTime: isoAt(yesterday, 14, 0),
      benchNumber: 1,
      lifecycleStatus: 'RETURNED',
      checkedOutAt: isoAt(yesterday, 11, 2),
      returnedAt: isoAt(yesterday, 13, 58),
      noShowMarkedAt: null,
    },
    {
      id: 'res-active-01',
      requestId: 'req-conf-01',
      equipmentId: 'eq-dobot-cr5',
      studentId: 'usr-stu-aarav',
      startTime: isoAt(day1, 9, 0),
      endTime: isoAt(day1, 11, 0),
      benchNumber: 1,
      lifecycleStatus: 'CONFIRMED',
      checkedOutAt: null,
      returnedAt: null,
      noShowMarkedAt: null,
    },
    {
      id: 'res-active-02',
      requestId: 'req-conf-02',
      equipmentId: 'eq-gpu-ws1',
      studentId: 'usr-stu-kabir',
      startTime: isoAt(day2, 10, 0),
      endTime: isoAt(day2, 13, 0),
      benchNumber: 1,
      lifecycleStatus: 'CONFIRMED',
      checkedOutAt: null,
      returnedAt: null,
      noShowMarkedAt: null,
    },
  ];

  // Compute deterministic slot locks for active (CONFIRMED / CHECKED_OUT) reservations
  const lockMap = new Map<string, SlotLock>();
  for (const res of reservations) {
    if (res.lifecycleStatus !== 'CONFIRMED' && res.lifecycleStatus !== 'CHECKED_OUT') continue;
    const buckets = computeSlotBucketIds(res.equipmentId, res.startTime, res.endTime, campusTimezone);
    for (const b of buckets) {
      const existing = lockMap.get(b.lockId);
      if (existing) {
        existing.activeReservationIds.push(res.id);
      } else {
        lockMap.set(b.lockId, {
          id: b.lockId,
          equipmentId: res.equipmentId,
          bucketKey: b.bucketKey,
          activeReservationIds: [res.id],
          updatedAt: nowIst.toUTC().toISO()!,
        });
      }
    }
  }
  const slotLocks = Array.from(lockMap.values());

  // Seed historical approved + live overlapping multi-student CONFLICT_REVIEW requests
  const bookingRequests: BookingRequest[] = [
    {
      id: 'req-hist-01',
      studentId: 'usr-stu-diya',
      equipmentId: 'eq-polymax-3d',
      projectTitle: 'Biomedical Microfluidic Manifold Enclosure',
      projectSummary: 'Printing rigid optical housing with water-soluble internal channels.',
      requiredCapabilities: ['multi-material', 'soluble-support'],
      justification: 'Requires dual IDEX extrusion for PVA internal support removal.',
      requestedStart: isoAt(twoDaysAgo, 10, 0),
      requestedEnd: isoAt(twoDaysAgo, 14, 0),
      durationHours: 4,
      projectDeadline: isoAt(day2, 18, 0),
      status: 'APPROVED',
      originalCreatedAt: nowIst.minus({ days: 5 }).toUTC().toISO()!,
      lastSubmittedAt: nowIst.minus({ days: 5 }).toUTC().toISO()!,
      smartFairSnapshot: null,
      facultyDecisionReason: 'Approved for ECE biomedical sensor capstone enclosure.',
      reviewedBy: 'usr-fac-vikram',
      createdAt: nowIst.minus({ days: 5 }).toUTC().toISO()!,
    },
    {
      id: 'req-conf-01',
      studentId: 'usr-stu-aarav',
      equipmentId: 'eq-dobot-cr5',
      projectTitle: 'ROS 2 Force-Guided PCB Assembly Cell',
      projectSummary: 'Testing closed-loop peg-in-hole insertion using force-torque feedback.',
      requiredCapabilities: ['6-dof-kinematics', 'ros2-control', 'force-torque-sensing'],
      justification: 'Capstone validation milestone requires 6-DOF ROS 2 Humble trajectory execution.',
      requestedStart: isoAt(day1, 9, 0),
      requestedEnd: isoAt(day1, 11, 0),
      durationHours: 2,
      projectDeadline: nowIst.plus({ days: 5 }).toUTC().toISO()!,
      status: 'APPROVED',
      originalCreatedAt: nowIst.minus({ hours: 48 }).toUTC().toISO()!,
      lastSubmittedAt: nowIst.minus({ hours: 48 }).toUTC().toISO()!,
      smartFairSnapshot: null,
      facultyDecisionReason: 'Highest priority capstone schedule and flush morning slot.',
      reviewedBy: 'usr-fac-ananya',
      createdAt: nowIst.minus({ hours: 48 }).toUTC().toISO()!,
    },
    // --- CONFLICT CLUSTER 1: PolyMax 3D Printer overlapping tomorrow 10:00-14:00 IST ---
    {
      id: 'req-conflict-3d-aarav',
      studentId: 'usr-stu-aarav',
      equipmentId: 'eq-polymax-3d',
      projectTitle: 'Carbon-Nylon Drone Gimbal Bracket',
      projectSummary:
        'Fabricating lightweight vibration-damped gimbal mount with soluble support lattice for autonomous quadrotor.',
      requiredCapabilities: ['multi-material', 'carbon-fiber-nylon', 'soluble-support'],
      justification:
        'Flight readiness review is in 4 days and requires structural carbon-nylon composite stiffness.',
      requestedStart: isoAt(day1, 10, 0),
      requestedEnd: isoAt(day1, 13, 0),
      durationHours: 3,
      projectDeadline: nowIst.plus({ days: 4 }).toUTC().toISO()!,
      status: 'CONFLICT_REVIEW',
      originalCreatedAt: nowIst.minus({ hours: 38 }).toUTC().toISO()!,
      lastSubmittedAt: nowIst.minus({ hours: 38 }).toUTC().toISO()!,
      smartFairSnapshot: null,
      facultyDecisionReason: null,
      reviewedBy: null,
      createdAt: nowIst.minus({ hours: 38 }).toUTC().toISO()!,
    },
    {
      id: 'req-conflict-3d-diya',
      studentId: 'usr-stu-diya',
      equipmentId: 'eq-polymax-3d',
      projectTitle: 'Wearable ECG Sensor Bezel Prototype',
      projectSummary:
        'Printing flexible TPU skin-contact gasket combined with rigid PETG electronics shell.',
      requiredCapabilities: ['multi-material'],
      justification: 'Dual-material gasket needs simultaneous flexible + rigid print pass.',
      requestedStart: isoAt(day1, 11, 0),
      requestedEnd: isoAt(day1, 14, 0),
      durationHours: 3,
      projectDeadline: nowIst.plus({ days: 14 }).toUTC().toISO()!,
      status: 'CONFLICT_REVIEW',
      originalCreatedAt: nowIst.minus({ hours: 12 }).toUTC().toISO()!,
      lastSubmittedAt: nowIst.minus({ hours: 12 }).toUTC().toISO()!,
      smartFairSnapshot: null,
      facultyDecisionReason: null,
      reviewedBy: null,
      createdAt: nowIst.minus({ hours: 12 }).toUTC().toISO()!,
    },
    {
      id: 'req-conflict-3d-kabir',
      studentId: 'usr-stu-kabir',
      equipmentId: 'eq-polymax-3d',
      projectTitle: 'Edge Server Rack Airflow Shroud',
      projectSummary: 'Printing ducted cooling shroud for AI lab compute node enclosure.',
      requiredCapabilities: ['large-format'],
      justification: 'Needs large 400mm build volume for single-piece duct printing.',
      requestedStart: isoAt(day1, 10, 30),
      requestedEnd: isoAt(day1, 12, 30),
      durationHours: 2,
      projectDeadline: nowIst.plus({ days: 7 }).toUTC().toISO()!,
      status: 'CONFLICT_REVIEW',
      // Kabir lacks FAB_3D_PRINTING certification -> triggers H4 CERTIFICATION_REQUIRED cleanly!
      originalCreatedAt: nowIst.minus({ hours: 20 }).toUTC().toISO()!,
      lastSubmittedAt: nowIst.minus({ hours: 20 }).toUTC().toISO()!,
      smartFairSnapshot: null,
      facultyDecisionReason: null,
      reviewedBy: null,
      createdAt: nowIst.minus({ hours: 20 }).toUTC().toISO()!,
    },
    // --- CONFLICT CLUSTER 2: Dual-RTX 4090 Workstation overlapping tomorrow 08:00-12:00 IST ---
    {
      id: 'req-conflict-gpu-kabir',
      studentId: 'usr-stu-kabir',
      equipmentId: 'eq-gpu-ws1',
      projectTitle: 'Vision-Language Navigation Model Fine-Tuning',
      projectSummary:
        'Training quantized 7B multimodal policy across 48 GB dual-GPU VRAM for campus rover navigation.',
      requiredCapabilities: ['multi-gpu-training', 'cuda-tensor', 'large-vram-48gb'],
      justification:
        'Requires 48 GB VRAM to fit batch training without gradient checkpoint degradation before demo.',
      requestedStart: isoAt(day1, 8, 0),
      requestedEnd: isoAt(day1, 12, 0),
      durationHours: 4,
      projectDeadline: nowIst.plus({ days: 3 }).toUTC().toISO()!,
      status: 'CONFLICT_REVIEW',
      originalCreatedAt: nowIst.minus({ hours: 52 }).toUTC().toISO()!,
      lastSubmittedAt: nowIst.minus({ hours: 52 }).toUTC().toISO()!,
      smartFairSnapshot: null,
      facultyDecisionReason: null,
      reviewedBy: null,
      createdAt: nowIst.minus({ hours: 52 }).toUTC().toISO()!,
    },
    {
      id: 'req-conflict-gpu-aarav',
      studentId: 'usr-stu-aarav',
      equipmentId: 'eq-gpu-ws1',
      projectTitle: 'Quadrotor Propeller CFD Mesh Simulation',
      projectSummary: 'Running transient CUDA-accelerated lattice Boltzmann airflow sweep.',
      requiredCapabilities: ['cfd-simulation', 'cuda-tensor'],
      justification: 'Need GPU solver acceleration to complete acoustic sweep before fabrication.',
      requestedStart: isoAt(day1, 9, 30),
      requestedEnd: isoAt(day1, 12, 30),
      durationHours: 3,
      projectDeadline: nowIst.plus({ days: 9 }).toUTC().toISO()!,
      status: 'CONFLICT_REVIEW',
      // Aarav lacks GPU_CLUSTER_AUTH certification -> triggers H4 so faculty sees H4 vs eligible contender
      originalCreatedAt: nowIst.minus({ hours: 18 }).toUTC().toISO()!,
      lastSubmittedAt: nowIst.minus({ hours: 18 }).toUTC().toISO()!,
      smartFairSnapshot: null,
      facultyDecisionReason: null,
      reviewedBy: null,
      createdAt: nowIst.minus({ hours: 18 }).toUTC().toISO()!,
    },
    // --- Pending clean request on Oscilloscope ---
    {
      id: 'req-pending-osc-diya',
      studentId: 'usr-stu-diya',
      equipmentId: 'eq-tek-mso54',
      projectTitle: 'SPI Flash Timing Jitter Characterization',
      projectSummary: 'Capturing 1 GHz eye diagrams on custom wearable PCB bus lines.',
      requiredCapabilities: ['high-bandwidth-1ghz', 'protocol-decode'],
      justification: 'Requires 1 GHz analog front-end and SPI trigger decode.',
      requestedStart: isoAt(day2, 9, 0),
      requestedEnd: isoAt(day2, 11, 30),
      durationHours: 2.5,
      projectDeadline: nowIst.plus({ days: 6 }).toUTC().toISO()!,
      status: 'PENDING',
      originalCreatedAt: nowIst.minus({ hours: 14 }).toUTC().toISO()!,
      lastSubmittedAt: nowIst.minus({ hours: 14 }).toUTC().toISO()!,
      smartFairSnapshot: null,
      facultyDecisionReason: null,
      reviewedBy: null,
      createdAt: nowIst.minus({ hours: 14 }).toUTC().toISO()!,
    },
  ];

  const auditLogs: AuditLog[] = [
    {
      id: 'aud-seed-01',
      actorId: 'usr-fac-vikram',
      actorRole: 'FACULTY',
      action: 'APPROVE',
      targetEntityId: 'req-hist-01',
      metadata: {
        equipmentId: 'eq-polymax-3d',
        studentId: 'usr-stu-diya',
        reason: 'Approved for ECE biomedical sensor capstone enclosure.',
        smartFairScore: 81.4,
      },
      timestamp: nowIst.minus({ days: 3 }).toUTC().toISO()!,
    },
    {
      id: 'aud-seed-02',
      actorId: 'usr-fac-ananya',
      actorRole: 'FACULTY',
      action: 'APPROVE',
      targetEntityId: 'req-conf-01',
      metadata: {
        equipmentId: 'eq-dobot-cr5',
        studentId: 'usr-stu-aarav',
        reason: 'Highest priority capstone schedule and flush morning slot.',
        smartFairScore: 86.2,
      },
      timestamp: nowIst.minus({ hours: 6 }).toUTC().toISO()!,
    },
    {
      id: 'aud-seed-03',
      actorId: 'usr-fac-vikram',
      actorRole: 'FACULTY',
      action: 'MAINTENANCE_BLOCK',
      targetEntityId: 'mnt-cnc-cal',
      metadata: {
        equipmentId: 'eq-pocket-cnc',
        reason: 'Quarterly 5-axis rotary trunnion laser alignment & spindle lubrication',
      },
      timestamp: nowIst.minus({ hours: 10 }).toUTC().toISO()!,
    },
  ];

  return {
    departments,
    users,
    equipment,
    bookingRequests,
    reservations,
    maintenanceWindows,
    slotLocks,
    auditLogs,
  };
}
