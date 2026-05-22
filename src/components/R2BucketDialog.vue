<template>
  <Teleport to="body">
    <div class="r2b-backdrop" @click.self="$emit('close')">
      <div class="r2b-dialog">
        <h3 class="r2b-title">Add R2 Bucket</h3>

        <div class="r2b-field">
          <label>Account</label>
          <select v-model="form.accountConfigId" class="r2b-select">
            <option value="">Select account…</option>
            <option v-for="a in settingsStore.r2Accounts" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>
        </div>
        <div class="r2b-field">
          <label>Bucket Name</label>
          <input v-model="form.bucketName" placeholder="my-docs" autocomplete="off" spellcheck="false" />
        </div>
        <div class="r2b-field">
          <label>Jurisdiction</label>
          <select v-model="form.jurisdiction" class="r2b-select">
            <option value="">Default (auto)</option>
            <option value="eu">EU</option>
          </select>
        </div>

        <p v-if="testStatus" :class="['r2b-status', testStatus.ok ? 'r2b-status--ok' : 'r2b-status--err']">
          {{ testStatus.message }}
        </p>

        <div class="r2b-actions">
          <button class="r2b-btn r2b-btn--test" :disabled="testing || !canTest" @click="testBucket">
            {{ testing ? 'Testing…' : 'Test' }}
          </button>
          <div class="r2b-actions-right">
            <button class="r2b-btn r2b-btn--cancel" @click="$emit('close')">Cancel</button>
            <button class="r2b-btn r2b-btn--save" :disabled="!canSave" @click="handleSave">Save</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import { listObjects } from '../services/r2Service';
import { useSettingsStore } from '../stores/settings';
import type { R2BucketConfig } from '../stores/settings';

const props = defineProps<{ defaultAccountId?: string }>();

const emit = defineEmits<{
  close: [];
  saved: [config: R2BucketConfig];
}>();

const settingsStore = useSettingsStore();

const form = reactive({
  accountConfigId: props.defaultAccountId ?? '',
  bucketName: '',
  jurisdiction: '',
});

const testing = ref(false);
const testStatus = ref<{ ok: boolean; message: string } | null>(null);

const canTest = computed(() => !!(form.accountConfigId && form.bucketName));
const canSave = computed(() => !!(form.accountConfigId && form.bucketName));

async function testBucket() {
  testing.value = true;
  testStatus.value = null;
  try {
    const account = settingsStore.r2Accounts.find(a => a.id === form.accountConfigId);
    if (!account) throw new Error('Account not found');
    const tempBucket: R2BucketConfig = {
      id: 'test',
      accountConfigId: form.accountConfigId,
      bucketName: form.bucketName.trim(),
      jurisdiction: (form.jurisdiction as 'eu') || undefined,
    };
    await listObjects(account, tempBucket, '', '/');
    testStatus.value = { ok: true, message: 'Connected successfully' };
  } catch (e) {
    testStatus.value = { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    testing.value = false;
  }
}

function handleSave() {
  if (!canSave.value) return;
  const config: R2BucketConfig = {
    id: crypto.randomUUID(),
    accountConfigId: form.accountConfigId,
    bucketName: form.bucketName.trim(),
    ...(form.jurisdiction ? { jurisdiction: form.jurisdiction as 'eu' } : {}),
  };
  emit('saved', config);
}
</script>

<style scoped>
.r2b-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.r2b-dialog {
  background: var(--dialog-bg);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 1.25rem 1.5rem 1rem;
  width: 360px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.r2b-title {
  margin: 0 0 1rem;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-color);
}

.r2b-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
}

.r2b-field label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.r2b-field input {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  font-size: 0.8125rem;
  color: var(--text-color);
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}

.r2b-field input:focus {
  border-color: var(--accent-color);
}

.r2b-select {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  font-size: 0.8125rem;
  color: var(--text-color);
  font-family: inherit;
  outline: none;
  cursor: pointer;
  transition: border-color 0.15s;
}

.r2b-select:focus {
  border-color: var(--accent-color);
}

.r2b-status {
  font-size: 0.75rem;
  margin: 0.25rem 0 0.75rem;
  padding: 0.35rem 0.6rem;
  border-radius: 5px;
}

.r2b-status--ok {
  background: var(--accent-subtle);
  color: var(--accent-color);
}

.r2b-status--err {
  background: color-mix(in srgb, red 12%, var(--dialog-bg));
  color: color-mix(in srgb, red 70%, var(--text-color));
}

.r2b-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.r2b-actions-right {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

.r2b-btn {
  border: none;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-family: inherit;
}

.r2b-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.r2b-btn--test {
  background: var(--bg-color);
  color: var(--text-muted);
  border: 1px solid var(--border-color);
}

.r2b-btn--test:not(:disabled):hover {
  color: var(--text-color);
}

.r2b-btn--cancel {
  background: transparent;
  color: var(--text-muted);
}

.r2b-btn--cancel:hover {
  color: var(--text-color);
}

.r2b-btn--save {
  background: var(--accent-color);
  color: #fff;
}

.r2b-btn--save:not(:disabled):hover {
  opacity: 0.88;
}
</style>
