import { defineStore } from "pinia";

export type TaskStatus = "待执行" | "执行中" | "已完成";

export const STATUSES: TaskStatus[] = ["待执行", "执行中", "已完成"];
export const ZONES = ["城北", "城东", "城南"];

export interface Vehicle {
  id: string;
  plate: string;
}

export interface Driver {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  title: string;
  zone: string;
  /** 计划日期，格式 YYYY-MM-DD */
  date: string;
  vehicleId: string;
  driverId: string;
  status: TaskStatus;
  notes: string;
  createdAt: string;
}

export interface ChangeLog {
  id: string;
  taskId: string;
  taskLabel: string;
  action: string;
  detail: string;
  time: string;
}

export interface Conflict {
  taskId: string;
  title: string;
  date: string;
  status: TaskStatus;
  reasons: string[];
}

interface DispatchState {
  tasks: Task[];
  vehicles: Vehicle[];
  drivers: Driver[];
  logs: ChangeLog[];
}

export interface TaskPayload {
  title: string;
  zone: string;
  date: string;
  vehicleId: string;
  driverId: string;
  notes: string;
}

export interface UpdatePayload {
  date: string;
  vehicleId: string;
  driverId: string;
  notes: string;
}

export type SaveResult = { ok: true } | { ok: false; conflicts: Conflict[] };

const STORAGE_KEY = "dfwlfront-3-dispatch-v2";
const LEGACY_KEY = "dfwlfront-3-dispatch";
const MAX_LOGS = 200;

export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toDateStr(value?: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = value ? new Date(value) : null;
  if (d && !Number.isNaN(d.getTime())) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return todayStr();
}

function normalizeStatus(status?: string): TaskStatus {
  if (status === "执行中") return "执行中";
  if (status === "已完成") return "已完成";
  // 旧数据中的“空闲”等状态一律视为待执行
  return "待执行";
}

function seedState(): DispatchState {
  const vehicles: Vehicle[] = [
    { id: "v-1", plate: "沪A-82L6" },
    { id: "v-2", plate: "沪B-73K9" },
    { id: "v-3", plate: "沪C-56D2" },
    { id: "v-4", plate: "沪D-31F8" }
  ];
  const drivers: Driver[] = [
    { id: "d-1", name: "董飞" },
    { id: "d-2", name: "周航" },
    { id: "d-3", name: "林岚" },
    { id: "d-4", name: "赵启明" }
  ];
  const tasks: Task[] = [
    {
      id: "seed-1",
      title: "商超补货",
      zone: "城北",
      date: todayStr(),
      vehicleId: "v-1",
      driverId: "d-1",
      status: "待执行",
      notes: "可立即派车",
      createdAt: new Date().toISOString()
    },
    {
      id: "seed-2",
      title: "医药配送",
      zone: "城东",
      date: todayStr(),
      vehicleId: "v-2",
      driverId: "d-2",
      status: "执行中",
      notes: "预计17:30返回",
      createdAt: new Date().toISOString()
    }
  ];
  return { vehicles, drivers, tasks, logs: [] };
}

interface LegacyRecord {
  id?: string;
  vehicle?: string;
  driver?: string;
  zone?: string;
  task?: string;
  status?: string;
  notes?: string;
  createdAt?: string;
}

/** 旧版本数据（车辆/司机/任务混在一条记录里）迁移为任务 + 资源台账结构 */
function migrateLegacy(records: LegacyRecord[]): DispatchState {
  const base = seedState();
  const vehicles = [...base.vehicles];
  const drivers = [...base.drivers];

  const ensureVehicle = (plate: string): string => {
    const found = vehicles.find((v) => v.plate === plate);
    if (found) return found.id;
    const created: Vehicle = { id: uuid(), plate };
    vehicles.push(created);
    return created.id;
  };
  const ensureDriver = (name: string): string => {
    const found = drivers.find((d) => d.name === name);
    if (found) return found.id;
    const created: Driver = { id: uuid(), name };
    drivers.push(created);
    return created.id;
  };

  const tasks: Task[] = records.map((r) => ({
    id: r.id || uuid(),
    title: r.task || "未命名任务",
    zone: r.zone || ZONES[0],
    date: toDateStr(r.createdAt),
    vehicleId: ensureVehicle(r.vehicle || "未登记车辆"),
    driverId: ensureDriver(r.driver || "未登记司机"),
    status: normalizeStatus(r.status),
    notes: r.notes || "",
    createdAt: r.createdAt || new Date().toISOString()
  }));

  const logs: ChangeLog[] = [
    {
      id: uuid(),
      taskId: "-",
      taskLabel: "系统",
      action: "数据迁移",
      detail: `已从旧版本导入 ${tasks.length} 条任务，可继续派车`,
      time: new Date().toISOString()
    }
  ];

  return { vehicles, drivers, tasks, logs };
}

function loadState(): DispatchState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DispatchState;
      if (
        parsed &&
        Array.isArray(parsed.tasks) &&
        Array.isArray(parsed.vehicles) &&
        Array.isArray(parsed.drivers)
      ) {
        return {
          tasks: parsed.tasks,
          vehicles: parsed.vehicles,
          drivers: parsed.drivers,
          logs: Array.isArray(parsed.logs) ? parsed.logs : []
        };
      }
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const records = JSON.parse(legacy) as LegacyRecord[];
      if (Array.isArray(records)) {
        const migrated = migrateLegacy(records);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
  } catch {
    // 数据损坏时回退到示例数据
  }
  return seedState();
}

export const useDispatchStore = defineStore("dispatch", {
  state: (): DispatchState => loadState(),
  getters: {
    vehiclePlate: (state) => (id: string): string =>
      state.vehicles.find((v) => v.id === id)?.plate ?? "未知车辆",
    driverName: (state) => (id: string): string =>
      state.drivers.find((d) => d.id === id)?.name ?? "未知司机"
  },
  actions: {
    persist() {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          tasks: this.tasks,
          vehicles: this.vehicles,
          drivers: this.drivers,
          logs: this.logs
        })
      );
    },
    pushLog(taskId: string, taskLabel: string, action: string, detail: string) {
      this.logs.unshift({
        id: uuid(),
        taskId,
        taskLabel,
        action,
        detail,
        time: new Date().toISOString()
      });
      if (this.logs.length > MAX_LOGS) this.logs.length = MAX_LOGS;
    },
    /** 某天占用资源的任务（未完成的才算占用，已完成即释放） */
    activeTasksOn(date: string, excludeTaskId?: string): Task[] {
      return this.tasks.filter(
        (t) => t.date === date && t.status !== "已完成" && t.id !== excludeTaskId
      );
    },
    isVehicleBusy(vehicleId: string, date: string, excludeTaskId?: string): boolean {
      return this.activeTasksOn(date, excludeTaskId).some((t) => t.vehicleId === vehicleId);
    },
    isDriverBusy(driverId: string, date: string, excludeTaskId?: string): boolean {
      return this.activeTasksOn(date, excludeTaskId).some((t) => t.driverId === driverId);
    },
    /** 检查某日期下车辆/司机是否已被其他任务占用 */
    conflictsOn(
      date: string,
      vehicleId: string,
      driverId: string,
      excludeTaskId?: string
    ): Conflict[] {
      const conflicts: Conflict[] = [];
      for (const task of this.activeTasksOn(date, excludeTaskId)) {
        const reasons: string[] = [];
        if (task.vehicleId === vehicleId) {
          reasons.push(
            `车辆 ${this.vehiclePlate(vehicleId)} 当天已有任务「${task.title}」（${task.status}）`
          );
        }
        if (task.driverId === driverId) {
          reasons.push(
            `司机 ${this.driverName(driverId)} 当天已有任务「${task.title}」（${task.status}）`
          );
        }
        if (reasons.length > 0) {
          conflicts.push({
            taskId: task.id,
            title: task.title,
            date: task.date,
            status: task.status,
            reasons
          });
        }
      }
      return conflicts;
    },
    addTask(payload: TaskPayload): SaveResult {
      const conflicts = this.conflictsOn(payload.date, payload.vehicleId, payload.driverId);
      if (conflicts.length > 0) return { ok: false, conflicts };
      const task: Task = {
        id: uuid(),
        status: "待执行",
        createdAt: new Date().toISOString(),
        ...payload
      };
      this.tasks.unshift(task);
      this.pushLog(
        task.id,
        task.title,
        "新建派车",
        `${this.driverName(task.driverId)} / ${this.vehiclePlate(task.vehicleId)}，计划 ${task.date} 执行`
      );
      this.persist();
      return { ok: true };
    },
    /** 改期 / 换人 / 换车：有冲突则拒绝保存，原安排保持不变 */
    updateTask(id: string, payload: UpdatePayload): SaveResult {
      const task = this.tasks.find((t) => t.id === id);
      if (!task) return { ok: false, conflicts: [] };
      const conflicts = this.conflictsOn(payload.date, payload.vehicleId, payload.driverId, id);
      if (conflicts.length > 0) return { ok: false, conflicts };
      if (task.date !== payload.date) {
        this.pushLog(id, task.title, "改期", `计划日期 ${task.date} → ${payload.date}`);
        task.date = payload.date;
      }
      if (task.vehicleId !== payload.vehicleId) {
        this.pushLog(
          id,
          task.title,
          "更换车辆",
          `${this.vehiclePlate(task.vehicleId)} → ${this.vehiclePlate(payload.vehicleId)}`
        );
        task.vehicleId = payload.vehicleId;
      }
      if (task.driverId !== payload.driverId) {
        this.pushLog(
          id,
          task.title,
          "更换司机",
          `${this.driverName(task.driverId)} → ${this.driverName(payload.driverId)}`
        );
        task.driverId = payload.driverId;
      }
      if (payload.notes !== task.notes) {
        this.pushLog(
          id,
          task.title,
          "更新备注",
          payload.notes ? `备注更新为：${payload.notes}` : "清空了备注"
        );
        task.notes = payload.notes;
      }
      this.persist();
      return { ok: true };
    },
    /** 待执行 → 执行中 → 已完成；完成后当天资源自动释放 */
    advanceStatus(id: string) {
      const task = this.tasks.find((t) => t.id === id);
      if (!task) return;
      if (task.status === "待执行") {
        task.status = "执行中";
        this.pushLog(id, task.title, "状态流转", "任务开始执行");
      } else if (task.status === "执行中") {
        task.status = "已完成";
        this.pushLog(
          id,
          task.title,
          "任务完成",
          `车辆 ${this.vehiclePlate(task.vehicleId)} 与司机 ${this.driverName(task.driverId)} 已释放，可继续派车`
        );
      }
      this.persist();
    },
    removeTask(id: string) {
      const task = this.tasks.find((t) => t.id === id);
      if (!task) return;
      this.pushLog(id, task.title, "删除任务", `已删除 ${task.date} 的「${task.title}」（${task.status}）`);
      this.tasks = this.tasks.filter((t) => t.id !== id);
      this.persist();
    },
    addVehicle(plate: string): boolean {
      const value = plate.trim();
      if (!value || this.vehicles.some((v) => v.plate === value)) return false;
      this.vehicles.push({ id: uuid(), plate: value });
      this.persist();
      return true;
    },
    addDriver(name: string): boolean {
      const value = name.trim();
      if (!value || this.drivers.some((d) => d.name === value)) return false;
      this.drivers.push({ id: uuid(), name: value });
      this.persist();
      return true;
    },
    removeVehicle(id: string): boolean {
      if (this.tasks.some((t) => t.vehicleId === id)) return false;
      this.vehicles = this.vehicles.filter((v) => v.id !== id);
      this.persist();
      return true;
    },
    removeDriver(id: string): boolean {
      if (this.tasks.some((t) => t.driverId === id)) return false;
      this.drivers = this.drivers.filter((d) => d.id !== id);
      this.persist();
      return true;
    }
  }
});
