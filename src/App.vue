<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  STATUSES,
  ZONES,
  todayStr,
  useDispatchStore,
  type Conflict,
  type Task,
  type TaskStatus
} from "./store";

const project = {
  title: "车辆调度工作台",
  industry: "物流",
  subtitle:
    "按日期派车：同一辆车、同一名司机当天只能承担一个未完成任务；改期换人自动校验冲突，所有调整留痕。",
  stack: ["Vue3", "Vite", "TypeScript", "Pinia", "Element Plus"],
  metricLabels: ["今日任务", "执行中", "今日空闲车辆"]
};

const store = useDispatchStore();
const { tasks, vehicles, drivers, logs } = storeToRefs(store);

const today = todayStr();

// ---------- 新建派车 ----------
const form = reactive({
  title: "",
  zone: ZONES[0],
  date: today,
  vehicleId: "",
  driverId: "",
  notes: ""
});

// 换日期后，已选资源若在新日期被占用则清空，避免误派
watch(
  () => form.date,
  (date) => {
    if (form.vehicleId && store.isVehicleBusy(form.vehicleId, date)) form.vehicleId = "";
    if (form.driverId && store.isDriverBusy(form.driverId, date)) form.driverId = "";
  }
);

function describeConflicts(conflicts: Conflict[]): string {
  return conflicts.flatMap((c) => c.reasons).join("；");
}

function submit() {
  const result = store.addTask({ ...form });
  if (!result.ok) {
    ElMessage.error({ message: `派车失败：${describeConflicts(result.conflicts)}`, duration: 5000 });
    return;
  }
  form.title = "";
  form.vehicleId = "";
  form.driverId = "";
  form.notes = "";
  ElMessage.success("派车成功，任务已创建");
}

// ---------- 列表筛选：按日期 + 状态 ----------
const dateFilter = ref("");
const statusFilter = ref<"全部状态" | TaskStatus>("全部状态");
const filteredTasks = computed(() =>
  tasks.value
    .filter((t) => !dateFilter.value || t.date === dateFilter.value)
    .filter((t) => statusFilter.value === "全部状态" || t.status === statusFilter.value)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || b.createdAt.localeCompare(a.createdAt))
);

// ---------- 指标 ----------
const metrics = computed(() => [
  tasks.value.filter((t) => t.date === today).length,
  tasks.value.filter((t) => t.status === "执行中").length,
  vehicles.value.filter((v) => !store.isVehicleBusy(v.id, today)).length
]);

const chartRows = computed(() =>
  STATUSES.map((status) => ({
    status,
    value: tasks.value.filter((t) => t.status === status).length
  }))
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((r) => r.value)));

// ---------- 改期 / 换人 ----------
const editingId = ref<string | null>(null);
const editForm = reactive({ date: "", vehicleId: "", driverId: "", notes: "" });
const editConflicts = ref<Conflict[]>([]);
const editingTask = computed(() => tasks.value.find((t) => t.id === editingId.value) ?? null);
const editConflictMessages = computed(() => editConflicts.value.flatMap((c) => c.reasons));

function openEdit(task: Task) {
  editingId.value = task.id;
  Object.assign(editForm, {
    date: task.date,
    vehicleId: task.vehicleId,
    driverId: task.driverId,
    notes: task.notes
  });
  editConflicts.value = [];
}

function closeEdit() {
  editingId.value = null;
  editConflicts.value = [];
}

function saveEdit() {
  if (!editingId.value) return;
  const result = store.updateTask(editingId.value, { ...editForm });
  if (!result.ok) {
    // 保存被拒绝：展示冲突，原安排保持不变
    editConflicts.value = result.conflicts;
    return;
  }
  ElMessage.success("已保存调整");
  closeEdit();
}

// ---------- 资源台账 ----------
const newPlate = ref("");
const newDriver = ref("");

function addVehicle() {
  if (store.addVehicle(newPlate.value)) {
    newPlate.value = "";
    ElMessage.success("已添加车辆");
  } else {
    ElMessage.warning("车牌为空或已存在");
  }
}

function addDriver() {
  if (store.addDriver(newDriver.value)) {
    newDriver.value = "";
    ElMessage.success("已添加司机");
  } else {
    ElMessage.warning("姓名为空或已存在");
  }
}

function removeVehicle(id: string, plate: string) {
  if (store.removeVehicle(id)) {
    ElMessage.success(`已删除车辆 ${plate}`);
  } else {
    ElMessage.warning(`车辆 ${plate} 已有任务记录，不能删除`);
  }
}

function removeDriver(id: string, name: string) {
  if (store.removeDriver(id)) {
    ElMessage.success(`已删除司机 ${name}`);
  } else {
    ElMessage.warning(`司机 ${name} 已有任务记录，不能删除`);
  }
}

function resourceBadge(id: string, kind: "vehicle" | "driver") {
  const hit = tasks.value.find(
    (t) =>
      t.date === today &&
      t.status !== "已完成" &&
      (kind === "vehicle" ? t.vehicleId === id : t.driverId === id)
  );
  const status = hit ? hit.status : "空闲";
  return { text: status === "空闲" ? "今日空闲" : `今日${status}`, cls: statusClass(status) };
}

// ---------- 状态流转 / 删除 ----------
function flow(task: Task) {
  store.advanceStatus(task.id);
  if (task.status === "已完成") {
    ElMessage.success(`任务「${task.title}」已完成，当天资源已释放`);
  }
}

async function removeTask(task: Task) {
  try {
    await ElMessageBox.confirm(
      `确定删除任务「${task.title}」吗？删除操作会保留在变更记录中。`,
      "删除任务",
      { confirmButtonText: "删除", cancelButtonText: "取消", type: "warning" }
    );
  } catch {
    return;
  }
  store.removeTask(task.id);
  ElMessage.success("任务已删除");
}

// ---------- 展示辅助 ----------
function statusClass(status: string) {
  if (status === "执行中") return "st-running";
  if (status === "已完成") return "st-done";
  if (status === "空闲") return "st-free";
  return "st-pending";
}

function flowText(task: Task) {
  return task.status === "待执行" ? "开始执行" : "完成任务";
}

function actionClass(action: string) {
  if (action === "新建派车") return "ac-create";
  if (action === "改期" || action === "更换车辆" || action === "更换司机") return "ac-change";
  if (action === "任务完成") return "ac-done";
  if (action === "删除任务") return "ac-danger";
  return "ac-info";
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ project.industry }}行业 · 派车工作台</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in project.metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong>{{ metrics[index] }}</strong>
        </article>
      </section>

      <section class="workspace">
        <div class="side">
          <form class="panel" @submit.prevent="submit">
            <h2>新建派车</h2>
            <div class="form-grid">
              <label>
                配送任务
                <input v-model="form.title" placeholder="如：商超补货" required />
              </label>
              <label>
                计划日期
                <input v-model="form.date" type="date" required />
              </label>
              <label>
                配送区域
                <select v-model="form.zone">
                  <option v-for="zone in ZONES" :key="zone">{{ zone }}</option>
                </select>
              </label>
              <label>
                车辆
                <select v-model="form.vehicleId" required>
                  <option value="" disabled>请选择车辆</option>
                  <option
                    v-for="v in vehicles"
                    :key="v.id"
                    :value="v.id"
                    :disabled="store.isVehicleBusy(v.id, form.date)"
                  >
                    {{ v.plate }}{{ store.isVehicleBusy(v.id, form.date) ? "（当天已有安排）" : "" }}
                  </option>
                </select>
              </label>
              <label>
                司机
                <select v-model="form.driverId" required>
                  <option value="" disabled>请选择司机</option>
                  <option
                    v-for="d in drivers"
                    :key="d.id"
                    :value="d.id"
                    :disabled="store.isDriverBusy(d.id, form.date)"
                  >
                    {{ d.name }}{{ store.isDriverBusy(d.id, form.date) ? "（当天已有安排）" : "" }}
                  </option>
                </select>
              </label>
              <label>
                备注
                <textarea v-model="form.notes" placeholder="填写处理说明或现场备注" />
              </label>
              <p class="form-help">仅可选择计划日期当天没有待执行 / 执行中任务的车辆与司机。</p>
              <button type="submit">派车</button>
            </div>
          </form>

          <section class="panel">
            <h2>资源台账</h2>
            <div class="res-section">
              <p class="res-title">车辆（{{ vehicles.length }}）</p>
              <div class="resource-list">
                <div v-for="v in vehicles" :key="v.id" class="resource-row">
                  <span>{{ v.plate }}</span>
                  <span class="row-right">
                    <span class="badge" :class="resourceBadge(v.id, 'vehicle').cls">
                      {{ resourceBadge(v.id, "vehicle").text }}
                    </span>
                    <button type="button" class="text-danger" @click="removeVehicle(v.id, v.plate)">删除</button>
                  </span>
                </div>
              </div>
              <div class="resource-add">
                <input v-model="newPlate" placeholder="新增车牌号" @keyup.enter="addVehicle" />
                <button type="button" class="secondary" @click="addVehicle">添加</button>
              </div>
            </div>
            <div class="res-section">
              <p class="res-title">司机（{{ drivers.length }}）</p>
              <div class="resource-list">
                <div v-for="d in drivers" :key="d.id" class="resource-row">
                  <span>{{ d.name }}</span>
                  <span class="row-right">
                    <span class="badge" :class="resourceBadge(d.id, 'driver').cls">
                      {{ resourceBadge(d.id, "driver").text }}
                    </span>
                    <button type="button" class="text-danger" @click="removeDriver(d.id, d.name)">删除</button>
                  </span>
                </div>
              </div>
              <div class="resource-add">
                <input v-model="newDriver" placeholder="新增司机姓名" @keyup.enter="addDriver" />
                <button type="button" class="secondary" @click="addDriver">添加</button>
              </div>
            </div>
          </section>
        </div>

        <section class="list-panel">
          <div class="toolbar">
            <h2>任务列表</h2>
            <div class="filters">
              <input v-model="dateFilter" type="date" />
              <button type="button" class="secondary" @click="dateFilter = today">今天</button>
              <button type="button" class="secondary" @click="dateFilter = ''">全部日期</button>
              <select v-model="statusFilter">
                <option>全部状态</option>
                <option v-for="s in STATUSES" :key="s">{{ s }}</option>
              </select>
            </div>
          </div>

          <div class="record-grid">
            <div v-if="filteredTasks.length === 0" class="empty">暂无匹配任务</div>
            <article v-for="task in filteredTasks" :key="task.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ task.title }}</p>
                <span class="status" :class="statusClass(task.status)">{{ task.status }}</span>
              </div>
              <div class="details">
                <span>计划日期: {{ task.date }}</span>
                <span>配送区域: {{ task.zone }}</span>
                <span>车辆: {{ store.vehiclePlate(task.vehicleId) }}</span>
                <span>司机: {{ store.driverName(task.driverId) }}</span>
              </div>
              <p class="note">{{ task.notes || "暂无备注" }}</p>
              <div class="actions">
                <button v-if="task.status !== '已完成'" type="button" @click="flow(task)">
                  {{ flowText(task) }}
                </button>
                <button
                  v-if="task.status !== '已完成'"
                  type="button"
                  class="secondary"
                  @click="openEdit(task)"
                >
                  改期 / 换人
                </button>
                <button type="button" class="danger" @click="removeTask(task)">删除</button>
              </div>
            </article>
          </div>

          <div class="mini-chart">
            <div v-for="row in chartRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track">
                <div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" />
              </div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>

      <section class="panel logs-panel">
        <h2>变更记录</h2>
        <div v-if="logs.length === 0" class="empty">暂无变更记录</div>
        <div v-else class="log-list">
          <div v-for="log in logs" :key="log.id" class="log-item">
            <span class="log-time">{{ fmtTime(log.time) }}</span>
            <span class="log-action" :class="actionClass(log.action)">{{ log.action }}</span>
            <span class="log-detail">
              <b class="log-task">{{ log.taskLabel }}</b> · {{ log.detail }}
            </span>
          </div>
        </div>
      </section>
    </div>

    <div v-if="editingTask" class="modal-overlay" @click.self="closeEdit">
      <div class="modal">
        <h2 class="modal-title">调整任务「{{ editingTask.title }}」</h2>
        <div class="form-grid">
          <label>
            计划日期
            <input v-model="editForm.date" type="date" required />
          </label>
          <label>
            车辆
            <select v-model="editForm.vehicleId">
              <option
                v-for="v in vehicles"
                :key="v.id"
                :value="v.id"
                :disabled="store.isVehicleBusy(v.id, editForm.date, editingTask.id)"
              >
                {{ v.plate
                }}{{ store.isVehicleBusy(v.id, editForm.date, editingTask.id) ? "（当天已有安排）" : "" }}
              </option>
            </select>
          </label>
          <label>
            司机
            <select v-model="editForm.driverId">
              <option
                v-for="d in drivers"
                :key="d.id"
                :value="d.id"
                :disabled="store.isDriverBusy(d.id, editForm.date, editingTask.id)"
              >
                {{ d.name
                }}{{ store.isDriverBusy(d.id, editForm.date, editingTask.id) ? "（当天已有安排）" : "" }}
              </option>
            </select>
          </label>
          <label>
            备注
            <textarea v-model="editForm.notes" />
          </label>

          <div v-if="editConflictMessages.length > 0" class="conflict-box">
            <strong>保存被拒绝：检测到资源冲突，原安排未改动。</strong>
            <ul>
              <li v-for="(msg, i) in editConflictMessages" :key="i">{{ msg }}</li>
            </ul>
          </div>

          <div class="modal-actions">
            <button type="button" class="secondary" @click="closeEdit">取消</button>
            <button type="button" @click="saveEdit">保存调整</button>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
