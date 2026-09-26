<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { storeToRefs } from "pinia";
import {
  STATUSES,
  todayStr,
  useDispatchStore,
  type ConflictItem,
  type DispatchTask,
  type TaskStatus
} from "./stores/dispatch";

const store = useDispatchStore();
const { tasks, vehicles, drivers } = storeToRefs(store);

const ZONES = ["城北", "城东", "城南"];
const metricLabels = ["车辆总数", "执行中任务", "今日可派车辆"];

// ---------- 新增派车 ----------
const form = reactive({
  planDate: todayStr(),
  vehicle: "",
  driver: "",
  zone: ZONES[0],
  task: "",
  note: ""
});
const formConflicts = ref<ConflictItem[]>([]);

const vehicleOptions = computed(() =>
  vehicles.value.map((name) => ({
    name,
    busy: store.conflictsOn(form.planDate, name, "").length > 0
  }))
);
const driverOptions = computed(() =>
  drivers.value.map((name) => ({
    name,
    busy: store.conflictsOn(form.planDate, "", name).length > 0
  }))
);

function submit() {
  const result = store.addTask({ ...form });
  if (!result.ok) {
    formConflicts.value = result.conflicts;
    return;
  }
  formConflicts.value = [];
  // 保留计划日期，方便同一天连续派车
  Object.assign(form, { vehicle: "", driver: "", zone: ZONES[0], task: "", note: "" });
}

// ---------- 资源台账 ----------
const newVehicle = ref("");
const newDriver = ref("");

function addVehicle() {
  store.addVehicle(newVehicle.value);
  newVehicle.value = "";
}
function addDriver() {
  store.addDriver(newDriver.value);
  newDriver.value = "";
}

// ---------- 列表筛选 ----------
const filterDate = ref("");
const filterStatus = ref("全部状态");

const filteredTasks = computed(() =>
  tasks.value
    .filter((task) => !filterDate.value || task.planDate === filterDate.value)
    .filter((task) => filterStatus.value === "全部状态" || task.status === filterStatus.value)
    .slice()
    .sort((a, b) => a.planDate.localeCompare(b.planDate) || b.createdAt.localeCompare(a.createdAt))
);

// ---------- 改期 / 换人 ----------
const editingId = ref<string | null>(null);
const editForm = reactive({ planDate: "", vehicle: "", driver: "" });
const editConflicts = ref<ConflictItem[]>([]);

const editVehicleOptions = computed(() =>
  vehicles.value.map((name) => ({
    name,
    busy: store.conflictsOn(editForm.planDate, name, "", editingId.value ?? undefined).length > 0
  }))
);
const editDriverOptions = computed(() =>
  drivers.value.map((name) => ({
    name,
    busy: store.conflictsOn(editForm.planDate, "", name, editingId.value ?? undefined).length > 0
  }))
);

function startEdit(task: DispatchTask) {
  editingId.value = task.id;
  editForm.planDate = task.planDate;
  editForm.vehicle = task.vehicle;
  editForm.driver = task.driver;
  editConflicts.value = [];
}
function cancelEdit() {
  editingId.value = null;
  editConflicts.value = [];
}
function saveEdit() {
  if (!editingId.value) return;
  const result = store.adjustTask(editingId.value, { ...editForm });
  if (!result.ok) {
    // 保存被拒绝，原安排不变，页面指出冲突
    editConflicts.value = result.conflicts;
    return;
  }
  cancelEdit();
}

// ---------- 展示辅助 ----------
const metrics = computed(() => [
  vehicles.value.length,
  tasks.value.filter((task) => task.status === "执行中").length,
  vehicles.value.filter((name) => store.conflictsOn(todayStr(), name, "").length === 0).length
]);

const chartRows = computed(() =>
  STATUSES.map((status) => ({
    status,
    value: tasks.value.filter((task) => task.status === status).length
  }))
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

function flowText(task: DispatchTask) {
  if (task.status === "待执行") return "开始执行";
  if (task.status === "执行中") return "完成任务";
  return "";
}

function statusClass(status: TaskStatus) {
  if (status === "执行中") return "is-active";
  if (status === "已完成") return "is-done";
  return "";
}

function conflictText(conflict: ConflictItem) {
  const task = conflict.task;
  return `${conflict.resource} ${conflict.name} 在 ${task.planDate} 已有任务「${task.task}」（${task.status}，${task.vehicle} / ${task.driver}）`;
}

function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN", { hour12: false });
}

function copySummary(task: DispatchTask) {
  navigator.clipboard?.writeText(
    `${task.planDate} ${task.vehicle} / ${task.driver}「${task.task}」${task.status}`
  );
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流行业前端最小闭环</p>
          <h1>车辆调度工作台</h1>
          <p class="subtitle">
            按天排班：任务记录计划日期，派车只开放当天空闲的车辆和司机；改期或换人时自动校验冲突，
            冲突即拒绝保存并保留原安排，每次调整都会留下变更记录，任务完成后释放当天资源。
          </p>
        </div>
        <div class="stack">
          <span v-for="item in ['Vue3', 'Vite', 'TypeScript', 'Pinia', 'Naive UI']" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong>{{ metrics[index] }}</strong>
        </article>
      </section>

      <section class="workspace">
        <form class="panel" @submit.prevent="submit">
          <h2>新增派车任务</h2>
          <div class="form-grid">
            <label>
              计划日期
              <input v-model="form.planDate" type="date" required />
            </label>
            <label>
              车辆（仅显示可选，占用项已置灰）
              <select v-model="form.vehicle" required>
                <option value="">请选择车辆</option>
                <option v-for="option in vehicleOptions" :key="option.name" :value="option.name" :disabled="option.busy">
                  {{ option.name }}{{ option.busy ? "（当日已有任务）" : "" }}
                </option>
              </select>
            </label>
            <label>
              司机（仅显示可选，占用项已置灰）
              <select v-model="form.driver" required>
                <option value="">请选择司机</option>
                <option v-for="option in driverOptions" :key="option.name" :value="option.name" :disabled="option.busy">
                  {{ option.name }}{{ option.busy ? "（当日已有任务）" : "" }}
                </option>
              </select>
            </label>
            <label>
              配送区域
              <select v-model="form.zone" required>
                <option v-for="zone in ZONES" :key="zone">{{ zone }}</option>
              </select>
            </label>
            <label>
              配送任务
              <input v-model="form.task" placeholder="例如：商超补货" required />
            </label>
            <label>
              备注
              <textarea v-model="form.note" placeholder="填写处理说明或现场备注" />
            </label>

            <div v-if="formConflicts.length" class="conflict">
              <strong>派车被拒绝：资源冲突</strong>
              <ul>
                <li v-for="(conflict, index) in formConflicts" :key="index">{{ conflictText(conflict) }}</li>
              </ul>
            </div>

            <button type="submit">派车</button>

            <div class="roster">
              <h3>资源台账</h3>
              <div class="roster-row">
                <input v-model="newVehicle" placeholder="新增车牌号" @keyup.enter.prevent="addVehicle" />
                <button type="button" class="secondary" @click="addVehicle">添加车辆</button>
              </div>
              <div class="roster-row">
                <input v-model="newDriver" placeholder="新增司机姓名" @keyup.enter.prevent="addDriver" />
                <button type="button" class="secondary" @click="addDriver">添加司机</button>
              </div>
              <p class="hint">
                同一天内，同一车辆/司机最多安排一个未完成任务（待执行或执行中）；任务完成后自动释放。
              </p>
            </div>
          </div>
        </form>

        <section class="list-panel">
          <div class="toolbar">
            <h2>任务列表</h2>
            <div class="filters">
              <input v-model="filterDate" type="date" aria-label="按日期筛选" />
              <button type="button" class="secondary" @click="filterDate = todayStr()">今天</button>
              <button type="button" class="secondary" :disabled="!filterDate" @click="filterDate = ''">全部日期</button>
              <select v-model="filterStatus" aria-label="按状态筛选">
                <option>全部状态</option>
                <option v-for="status in STATUSES" :key="status">{{ status }}</option>
              </select>
            </div>
          </div>

          <div class="record-grid">
            <div v-if="filteredTasks.length === 0" class="empty">暂无匹配任务</div>
            <article v-for="task in filteredTasks" :key="task.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ task.vehicle }} / {{ task.driver }}</p>
                <span class="status" :class="statusClass(task.status)">{{ task.status }}</span>
              </div>
              <div class="details">
                <span>计划日期: {{ task.planDate }}</span>
                <span>配送区域: {{ task.zone }}</span>
                <span>配送任务: {{ task.task }}</span>
                <span>创建时间: {{ formatTime(task.createdAt) }}</span>
              </div>
              <p class="note">{{ task.notes }}</p>

              <div v-if="editingId === task.id" class="edit-panel">
                <div class="edit-grid">
                  <label>
                    计划日期
                    <input v-model="editForm.planDate" type="date" required />
                  </label>
                  <label>
                    车辆
                    <select v-model="editForm.vehicle" required>
                      <option v-for="option in editVehicleOptions" :key="option.name" :value="option.name" :disabled="option.busy">
                        {{ option.name }}{{ option.busy ? "（当日已有任务）" : "" }}
                      </option>
                    </select>
                  </label>
                  <label>
                    司机
                    <select v-model="editForm.driver" required>
                      <option v-for="option in editDriverOptions" :key="option.name" :value="option.name" :disabled="option.busy">
                        {{ option.name }}{{ option.busy ? "（当日已有任务）" : "" }}
                      </option>
                    </select>
                  </label>
                </div>
                <div v-if="editConflicts.length" class="conflict">
                  <strong>保存被拒绝：资源冲突，原安排保持不变</strong>
                  <ul>
                    <li v-for="(conflict, index) in editConflicts" :key="index">{{ conflictText(conflict) }}</li>
                  </ul>
                </div>
                <div class="actions">
                  <button type="button" @click="saveEdit">保存调整</button>
                  <button type="button" class="secondary" @click="cancelEdit">取消</button>
                </div>
              </div>

              <details v-if="task.logs.length" class="logs">
                <summary>变更记录（{{ task.logs.length }}）</summary>
                <ul>
                  <li v-for="(log, index) in task.logs" :key="index">
                    <span class="log-time">{{ formatTime(log.time) }}</span>
                    【{{ log.action }}】{{ log.detail }}
                  </li>
                </ul>
              </details>

              <div class="actions">
                <button v-if="flowText(task)" type="button" @click="store.advanceStatus(task.id)">
                  {{ flowText(task) }}
                </button>
                <button type="button" class="secondary" @click="startEdit(task)">改期 / 换人</button>
                <button type="button" class="secondary" @click="copySummary(task)">复制摘要</button>
                <button type="button" class="danger" @click="store.removeTask(task.id)">删除</button>
              </div>
            </article>
          </div>

          <div class="mini-chart">
            <div v-for="row in chartRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>
    </div>
  </main>
</template>
