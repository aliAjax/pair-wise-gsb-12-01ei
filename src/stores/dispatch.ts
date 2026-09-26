import { defineStore } from "pinia";

export const STATUSES = ["待执行", "执行中", "已完成"] as const;
export type TaskStatus = (typeof STATUSES)[number];

export interface ChangeLog {
  time: string;
  action: string;
  detail: string;
}

export interface DispatchTask {
  id: string;
  planDate: string; // YYYY-MM-DD
  vehicle: string;
  driver: string;
  zone: string;
  task: string;
  status: TaskStatus;
  notes: string;
  createdAt: string;
  logs: ChangeLog[];
}

export interface ConflictItem {
  resource: "车辆" | "司机";
  name: string;
  task: DispatchTask;
}

export interface TaskInput {
  planDate: string;
  vehicle: string;
  driver: string;
  zone: string;
  task: string;
  note: string;
}

interface PersistedState {
  version: 2;
  tasks: DispatchTask[];
  vehicles: string[];
  drivers: string[];
}

const STORAGE_KEY = "dfwlfront-3-dispatch";

const SEED_VEHICLES = ["沪A-82L6", "沪B-73K9", "沪C-31N8"];
const SEED_DRIVERS = ["董飞", "周航", "林岚"];

export function todayStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mergeNames(...lists: unknown[]): string[] {
  const names: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const name = String(item ?? "").trim();
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

function normalizeStatus(status: unknown): TaskStatus {
  if (status === "执行中" || status === "已完成") return status;
  return "待执行"; // 旧数据中的“空闲”等状态一律视为待执行
}

function migrateTask(raw: Record<string, unknown>, index: number): DispatchTask {
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
  const planDate =
    typeof raw.planDate === "string" && raw.planDate ? raw.planDate : createdAt.slice(0, 10);
  return {
    id: typeof raw.id === "string" ? raw.id : `task-${index}-${crypto.randomUUID()}`,
    planDate,
    vehicle: String(raw.vehicle ?? ""),
    driver: String(raw.driver ?? ""),
    zone: String(raw.zone ?? "城北"),
    task: String(raw.task ?? ""),
    status: normalizeStatus(raw.status),
    notes: String(raw.notes ?? ""),
    createdAt,
    logs: Array.isArray(raw.logs) ? (raw.logs as ChangeLog[]) : []
  };
}

function seedState(): PersistedState {
  const today = todayStr();
  const seedTasks = [
    {
      vehicle: "沪A-82L6",
      driver: "董飞",
      zone: "城北",
      task: "商超补货",
      status: "待执行",
      notes: "可立即派车",
      planDate: today
    },
    {
      vehicle: "沪B-73K9",
      driver: "周航",
      zone: "城东",
      task: "医药配送",
      status: "执行中",
      notes: "预计17:30返回",
      planDate: today
    }
  ].map((raw, index) =>
    migrateTask(
      { ...raw, id: `seed-${index + 1}`, createdAt: new Date(Date.now() - index * 3600000).toISOString() },
      index
    )
  );
  return { version: 2, tasks: seedTasks, vehicles: [...SEED_VEHICLES], drivers: [...SEED_DRIVERS] };
}

function loadState(): PersistedState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedState();
  try {
    const parsed = JSON.parse(raw);
    // 旧版本数据：直接是记录数组，车辆/司机混在任务里
    if (Array.isArray(parsed)) {
      const tasks = parsed.map((item, index) => migrateTask(item ?? {}, index));
      return {
        version: 2,
        tasks,
        vehicles: mergeNames(SEED_VEHICLES, tasks.map((t) => t.vehicle)),
        drivers: mergeNames(SEED_DRIVERS, tasks.map((t) => t.driver))
      };
    }
    if (parsed && Array.isArray(parsed.tasks)) {
      const tasks: DispatchTask[] = parsed.tasks.map((item: Record<string, unknown>, index: number) =>
        migrateTask(item ?? {}, index)
      );
      return {
        version: 2,
        tasks,
        vehicles: mergeNames(parsed.vehicles, tasks.map((t) => t.vehicle)),
        drivers: mergeNames(parsed.drivers, tasks.map((t) => t.driver))
      };
    }
    return seedState();
  } catch {
    return seedState();
  }
}

/**
 * 冲突规则：同一天内，同一车辆/司机最多只能有一个未完成任务
 * （待执行或执行中）。任务完成后资源自动释放。
 */
export function findConflicts(
  tasks: DispatchTask[],
  date: string,
  vehicle: string,
  driver: string,
  excludeId?: string
): ConflictItem[] {
  const conflicts: ConflictItem[] = [];
  for (const task of tasks) {
    if (task.id === excludeId) continue;
    if (task.planDate !== date) continue;
    if (task.status === "已完成") continue;
    if (vehicle && task.vehicle === vehicle) {
      conflicts.push({ resource: "车辆", name: vehicle, task });
    }
    if (driver && task.driver === driver) {
      conflicts.push({ resource: "司机", name: driver, task });
    }
  }
  return conflicts;
}

export const useDispatchStore = defineStore("dispatch", {
  state: (): PersistedState => loadState(),
  getters: {
    conflictsOn:
      (state) =>
      (date: string, vehicle: string, driver: string, excludeId?: string): ConflictItem[] =>
        findConflicts(state.tasks, date, vehicle, driver, excludeId)
  },
  actions: {
    persist() {
      const state: PersistedState = {
        version: 2,
        tasks: this.tasks,
        vehicles: this.vehicles,
        drivers: this.drivers
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    },
    addTask(input: TaskInput) {
      const conflicts = findConflicts(this.tasks, input.planDate, input.vehicle, input.driver);
      if (conflicts.length) return { ok: false as const, conflicts };
      const now = new Date().toISOString();
      this.tasks.unshift({
        id: crypto.randomUUID(),
        planDate: input.planDate,
        vehicle: input.vehicle,
        driver: input.driver,
        zone: input.zone,
        task: input.task,
        status: "待执行",
        notes: input.note || "暂无备注",
        createdAt: now,
        logs: [
          {
            time: now,
            action: "创建派车",
            detail: `${input.planDate} 由 ${input.driver} 驾驶 ${input.vehicle} 执行「${input.task}」`
          }
        ]
      });
      this.persist();
      return { ok: true as const, conflicts: [] as ConflictItem[] };
    },
    adjustTask(id: string, changes: { planDate: string; vehicle: string; driver: string }) {
      const task = this.tasks.find((item) => item.id === id);
      if (!task) return { ok: false as const, conflicts: [] as ConflictItem[] };
      // 有冲突则拒绝保存，原安排保持不变
      const conflicts = findConflicts(
        this.tasks,
        changes.planDate,
        changes.vehicle,
        changes.driver,
        id
      );
      if (conflicts.length) return { ok: false as const, conflicts };
      const diffs: string[] = [];
      if (changes.planDate !== task.planDate) {
        diffs.push(`计划日期 ${task.planDate} → ${changes.planDate}`);
      }
      if (changes.vehicle !== task.vehicle) {
        diffs.push(`车辆 ${task.vehicle} → ${changes.vehicle}`);
      }
      if (changes.driver !== task.driver) {
        diffs.push(`司机 ${task.driver} → ${changes.driver}`);
      }
      if (diffs.length) {
        Object.assign(task, changes);
        task.logs.push({
          time: new Date().toISOString(),
          action: "调整",
          detail: diffs.join("；")
        });
        this.persist();
      }
      return { ok: true as const, conflicts: [] as ConflictItem[] };
    },
    advanceStatus(id: string) {
      const task = this.tasks.find((item) => item.id === id);
      if (!task) return;
      const index = STATUSES.indexOf(task.status);
      if (index < 0 || index >= STATUSES.length - 1) return;
      const from = task.status;
      task.status = STATUSES[index + 1];
      const detail =
        task.status === "已完成"
          ? `${from} → ${task.status}，${task.planDate} 当天的车辆与司机已释放`
          : `${from} → ${task.status}`;
      task.logs.push({ time: new Date().toISOString(), action: "状态流转", detail });
      this.persist();
    },
    removeTask(id: string) {
      this.tasks = this.tasks.filter((item) => item.id !== id);
      this.persist();
    },
    addVehicle(name: string) {
      const trimmed = name.trim();
      if (trimmed && !this.vehicles.includes(trimmed)) {
        this.vehicles.push(trimmed);
        this.persist();
      }
    },
    addDriver(name: string) {
      const trimmed = name.trim();
      if (trimmed && !this.drivers.includes(trimmed)) {
        this.drivers.push(trimmed);
        this.persist();
      }
    }
  }
});
